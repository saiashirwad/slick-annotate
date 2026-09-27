import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { formatSession } from './copy.ts'
import { errorMessage } from './errors.ts'
import { load, save, type Annotation, type Range, type Session, type ThreadAnchor } from './session.ts'
import { wholeLines } from './lines.ts'

export function activateAnnotations(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const root = folder.uri.fsPath
  let session: Session

  try {
    session = load(root)
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Annotations are off until .tandem/session.json is fixed and the window reloaded: ${errorMessage(error)}`,
    )

    return
  }

  let sessionGeneration = 0
  const registered = new WeakMap<vscode.Comment, { id: string; thread: vscode.CommentThread }>()
  const anchors = new Map<vscode.CommentThread, ThreadAnchor>()
  const controller = vscode.comments.createCommentController('tandem', 'Tandem')
  controller.options = { placeHolder: 'Annotate…' }

  function canAnnotate(uri: vscode.Uri) {
    return uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString()
  }

  function refuseOutsideWorkspace() {
    vscode.window.setStatusBarMessage(`Only files in ${folder.name} can be annotated`, 3000)
  }

  controller.commentingRangeProvider = {
    provideCommentingRanges: (document) =>
      canAnnotate(document.uri)
        ? [new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end)]
        : [],
  }

  function createComment(annotation: Annotation, thread: vscode.CommentThread, mode = vscode.CommentMode.Preview) {
    const comment = toComment(annotation, mode)
    registered.set(comment, { id: annotation.id, thread })

    return comment
  }

  function createThread(anchor: ThreadAnchor) {
    const uri = vscode.Uri.joinPath(folder.uri, anchor.file)
    const range = anchor.range ? toRange(anchor.range) : undefined
    const thread = controller.createCommentThread(uri, range ?? new vscode.Range(0, 0, 0, 0), [])
    thread.range = range

    return thread
  }

  for (const annotations of Map.groupBy(session.annotations, (annotation) => annotation.threadId).values()) {
    const { threadId, file, range, snippet } = annotations[0]
    const anchor = { threadId, file, range, snippet }
    const thread = createThread(anchor)
    thread.comments = annotations.map((annotation) => createComment(annotation, thread))
    anchors.set(thread, anchor)
    collapseSavedThread(thread)
  }

  // The session changes only once it's on disk, so a failed write leaves both unchanged.
  function commit(next: Session) {
    try {
      save(root, next)
    } catch (error) {
      void vscode.window.showWarningMessage(`Could not save annotations: ${errorMessage(error)}`)

      return false
    }

    session = next

    return true
  }

  function newAnchor(uri: vscode.Uri, document?: vscode.TextDocument, range?: vscode.Range): ThreadAnchor {
    return {
      threadId: randomUUID(),
      file: vscode.workspace.asRelativePath(uri, false),
      range: range ? fromRange(range) : undefined,
      snippet: document && range ? document.getText(range) : '',
    }
  }

  // With a line, the thread whose range covers it; without, the file's whole-file thread.
  function threadAt(uri: vscode.Uri, line?: number) {
    return [...anchors.keys()].find((thread) => {
      if (thread.uri.toString() !== uri.toString()) return false

      if (line === undefined) return !thread.range

      return !!thread.range && thread.range.start.line <= line && line <= thread.range.end.line
    })
  }

  function appendAnnotation(anchor: ThreadAnchor, body: string, thread?: vscode.CommentThread) {
    if (!body.trim()) return false
    const annotation: Annotation = { ...anchor, id: randomUUID(), body, createdAt: new Date().toISOString() }

    if (!commit({ annotations: [...session.annotations, annotation] })) return false

    if (!thread) thread = createThread(anchor)
    else if (!anchors.has(thread)) thread.range = anchor.range ? toRange(anchor.range) : undefined
    anchors.set(thread, anchor)
    thread.comments = [...thread.comments, createComment(annotation, thread)]
    collapseSavedThread(thread)

    return true
  }

  // Undefined once the annotation is deleted or the session cleared, so stale comments do nothing.
  function annotationFor(comment: vscode.Comment) {
    const entry = registered.get(comment)
    const annotation = entry && session.annotations.find((current) => current.id === entry.id)

    return entry && annotation && { annotation, thread: entry.thread }
  }

  function setCommentMode(comment: vscode.Comment, mode: vscode.CommentMode) {
    const found = annotationFor(comment)

    if (!found) return
    const { annotation, thread } = found
    thread.comments = thread.comments.map((current) =>
      current === comment ? createComment(annotation, thread, mode) : current,
    )
  }

  async function askForAnnotation(
    anchor: ThreadAnchor,
    title: string,
    thread?: vscode.CommentThread,
    document?: vscode.TextDocument,
  ) {
    const generation = sessionGeneration
    const documentVersion = document?.version
    const body = await vscode.window.showInputBox({ title, placeHolder: 'Annotate…', ignoreFocusOut: true })

    if (!body?.trim()) return

    if (generation !== sessionGeneration || (thread && !anchors.has(thread))) {
      vscode.window.setStatusBarMessage(
        'The session was cleared or the thread deleted. Select the code again to annotate it.',
        5000,
      )

      return
    }

    if (appendAnnotation(anchor, body, thread) && document && document.version !== documentVersion) {
      vscode.window.setStatusBarMessage(
        'Code changed while you wrote. The annotation keeps the snapshot you selected.',
        5000,
      )
    }
  }

  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('tandem.annotateSelection', async () => {
      const editor = vscode.window.activeTextEditor

      if (!editor) return
      const { document, selection } = editor

      if (!canAnnotate(document.uri)) return refuseOutsideWorkspace()
      const existing = selection.isEmpty ? threadAt(document.uri, selection.active.line) : undefined
      const savedAnchor = existing && anchors.get(existing)
      const range = existing?.range ?? wholeLines(document, selection)
      const anchor = savedAnchor ?? newAnchor(document.uri, document, range)

      await askForAnnotation(
        anchor,
        `${existing ? 'Add to the annotation on' : 'Annotate'} ${linesOf(range)}`,
        existing,
        savedAnchor ? undefined : document,
      )
    }),

    vscode.commands.registerCommand('tandem.annotate', async ({ thread, text }: vscode.CommentReply) => {
      if (!text.trim()) return

      if (!canAnnotate(thread.uri)) return refuseOutsideWorkspace()
      let anchor = anchors.get(thread)

      if (!anchor) {
        const document = vscode.workspace.textDocuments.find(
          (document) => document.uri.toString() === thread.uri.toString(),
        )

        if (!document && thread.range) {
          void vscode.window.showWarningMessage('Open the file again before saving this annotation.')

          return
        }

        anchor = newAnchor(thread.uri, document, document && thread.range && wholeLines(document, thread.range))
      }

      if (appendAnnotation(anchor, text, thread)) {
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      }
    }),

    vscode.commands.registerCommand('tandem.annotateFile', async (uri?: vscode.Uri) => {
      const file = uri ?? vscode.window.activeTextEditor?.document.uri

      if (!file) return

      if (!canAnnotate(file)) return refuseOutsideWorkspace()

      try {
        await vscode.window.showTextDocument(file)

        const existing = threadAt(file)
        const anchor = (existing && anchors.get(existing)) ?? newAnchor(file)

        await askForAnnotation(
          anchor,
          `${existing ? 'Add to the annotation on' : 'Annotate'} ${basename(file.path)}`,
          existing,
        )
      } catch (error) {
        void vscode.window.showWarningMessage(`Could not annotate ${basename(file.path)}: ${errorMessage(error)}`)
      }
    }),

    vscode.commands.registerCommand('tandem.copySession', async () => {
      const count = session.annotations.length

      if (count === 0) return vscode.window.setStatusBarMessage('No annotations to copy', 2000)

      try {
        await vscode.env.clipboard.writeText(formatSession(session))
        vscode.window.setStatusBarMessage(`Copied ${count} annotation${count === 1 ? '' : 's'}`, 2000)
      } catch (error) {
        void vscode.window.showWarningMessage(`Could not copy annotations: ${errorMessage(error)}`)
      }
    }),

    vscode.commands.registerCommand('tandem.clearSession', async () => {
      const count = session.annotations.length

      if (count === 0) return vscode.window.setStatusBarMessage('No annotations to clear', 2000)

      const answer = await vscode.window.showWarningMessage(
        `Delete all ${count} annotation${count === 1 ? '' : 's'}?`,
        { modal: true },
        'Clear',
      )

      if (answer !== 'Clear' || !commit({ annotations: [] })) return
      sessionGeneration++

      for (const thread of anchors.keys()) thread.dispose()
      anchors.clear()
    }),

    vscode.commands.registerCommand('tandem.editAnnotation', (comment: vscode.Comment) =>
      setCommentMode(comment, vscode.CommentMode.Editing),
    ),
    vscode.commands.registerCommand('tandem.cancelEdit', (comment: vscode.Comment) =>
      setCommentMode(comment, vscode.CommentMode.Preview),
    ),

    vscode.commands.registerCommand('tandem.saveAnnotation', (comment: vscode.Comment) => {
      const found = annotationFor(comment)
      const body = comment.body instanceof vscode.MarkdownString ? comment.body.value : comment.body

      if (!found || !body.trim()) return
      const { id } = found.annotation
      const annotations = session.annotations.map((current) => (current.id === id ? { ...current, body } : current))

      if (!commit({ annotations })) return
      setCommentMode(comment, vscode.CommentMode.Preview)
    }),

    vscode.commands.registerCommand('tandem.deleteAnnotation', (comment: vscode.Comment) => {
      const found = annotationFor(comment)

      if (!found) return
      const { annotation, thread } = found

      if (!commit({ annotations: session.annotations.filter((current) => current.id !== annotation.id) })) return
      thread.comments = thread.comments.filter((current) => current !== comment)

      if (thread.comments.length === 0) {
        anchors.delete(thread)
        thread.dispose()
      }
    }),
  )
}

function collapseSavedThread(thread: vscode.CommentThread) {
  thread.canReply = false
  const label = thread.range ? linesOf(thread.range) : basename(thread.uri.path)
  thread.label = label[0].toUpperCase() + label.slice(1)
  thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed
}

function linesOf({ start, end }: vscode.Range) {
  return start.line === end.line ? `line ${start.line + 1}` : `lines ${start.line + 1}–${end.line + 1}`
}

function toComment(annotation: Annotation, mode: vscode.CommentMode): vscode.Comment {
  return { body: annotation.body, mode, author: { name: 'You' }, timestamp: new Date(annotation.createdAt) }
}

function fromRange({ start, end }: vscode.Range): Range {
  return { start: { line: start.line, character: start.character }, end: { line: end.line, character: end.character } }
}

function toRange({ start, end }: Range) {
  return new vscode.Range(start.line, start.character, end.line, end.character)
}
