import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { format } from './copy.ts'
import { load, save, type Annotation, type Range } from './session.ts'

type Note = vscode.Comment & { id: string }

// Proposed API `commentReveal`: the only way to put the cursor in a thread's reply box.
type Revealable = vscode.CommentThread & {
  reveal(comment?: vscode.Comment, options?: { focus?: number }): Thenable<void>
}
const focusReply = { focus: 1 } // CommentThreadFocus.Reply

export function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return
  const root = folder.uri.fsPath
  const session = load(root)
  const persist = () => save(root, session)

  const controller = vscode.comments.createCommentController('slick-annotate', 'Slick Annotate')
  controller.options = { placeHolder: 'Annotate…' }
  controller.commentingRangeProvider = {
    provideCommentingRanges: (document) =>
      document.uri.scheme === 'file'
        ? [new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end)]
        : [],
  }

  // Threads with at least one saved annotation. Threads started from the gutter "+" are created by
  // VS Code itself, so we only learn about them when their first annotation is saved.
  const threads = new Set<vscode.CommentThread>()

  for (const annotations of Map.groupBy(session.annotations, (a) => a.threadId).values()) {
    const first = annotations[0]
    const uri = vscode.Uri.joinPath(folder.uri, first.file)
    const thread = createThread(uri, first.range && toRange(first.range), annotations.map(toNote))
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed
    threads.add(thread)
  }

  // The API needs a range at creation; a thread without one belongs to the whole file.
  function createThread(uri: vscode.Uri, range: vscode.Range | undefined, notes: Note[]) {
    const thread = controller.createCommentThread(uri, range ?? new vscode.Range(0, 0, 0, 0), notes)
    if (!range) thread.range = undefined
    return thread
  }

  // Snaps a brand-new thread to whole lines, starts tracking it, and returns its snippet.
  function begin(thread: vscode.CommentThread) {
    if (!thread.range) {
      threads.add(thread)
      return ''
    }
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === thread.uri.toString())
    if (!document || !thread.range) return
    thread.range = wholeLines(document, thread.range)
    threads.add(thread)
    return document.getText(thread.range)
  }

  const find = (note: Note) => session.annotations.find((a) => a.id === note.id)

  function threadOf(note: Note) {
    for (const thread of threads) {
      if (thread.comments.some((c) => (c as Note).id === note.id)) return thread
    }
  }

  function setMode(note: Note, mode: vscode.CommentMode, body?: string) {
    const thread = threadOf(note)
    if (!thread) return
    thread.comments = thread.comments.map((c) =>
      (c as Note).id === note.id ? { ...c, mode, body: body ?? c.body } : c,
    )
  }

  context.subscriptions.push(
    controller,

    // Inside an existing annotation with nothing selected: add to its thread. Otherwise: start a new one.
    vscode.commands.registerCommand('slick.annotateSelection', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const { document, selection } = editor
      const line = selection.active.line
      const existing = selection.isEmpty
        ? [...threads].find(
            (t) =>
              t.uri.toString() === document.uri.toString() &&
              t.range &&
              t.range.start.line <= line &&
              line <= t.range.end.line,
          )
        : undefined
      const thread = existing ?? controller.createCommentThread(document.uri, wholeLines(document, selection), [])
      await (thread as Revealable).reveal(undefined, focusReply)
    }),

    vscode.commands.registerCommand('slick.annotate', ({ thread, text }: vscode.CommentReply) => {
      const previous = thread.comments[0] && find(thread.comments[0] as Note)
      const snippet = previous?.snippet ?? begin(thread)
      if (snippet === undefined || !text.trim()) return
      const annotation: Annotation = {
        id: randomUUID(),
        threadId: previous?.threadId ?? randomUUID(),
        file: vscode.workspace.asRelativePath(thread.uri, false),
        range: thread.range && fromRange(thread.range),
        snippet,
        body: text,
        createdAt: new Date().toISOString(),
      }
      session.annotations.push(annotation)
      persist()
      thread.comments = [...thread.comments, toNote(annotation)]
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed
      // Collapsing hides the comment box but leaves focus in it; hand focus back to the code.
      vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    }),

    vscode.commands.registerCommand('slick.annotateFile', async (uri?: vscode.Uri) => {
      uri ??= vscode.window.activeTextEditor?.document.uri
      if (!uri) return
      await vscode.window.showTextDocument(uri)
      const existing = [...threads].find((t) => !t.range && t.uri.toString() === uri.toString())
      const thread = existing ?? createThread(uri, undefined, [])
      await (thread as Revealable).reveal(undefined, focusReply)
    }),

    vscode.commands.registerCommand('slick.copySession', async () => {
      const count = session.annotations.length
      if (count === 0) return vscode.window.setStatusBarMessage('No annotations to copy', 2000)
      await vscode.env.clipboard.writeText(format(session))
      vscode.window.setStatusBarMessage(`Copied ${count} annotation${count === 1 ? '' : 's'}`, 2000)
    }),

    vscode.commands.registerCommand('slick.clearSession', async () => {
      const count = session.annotations.length
      if (count === 0) return vscode.window.setStatusBarMessage('No annotations to clear', 2000)
      const clear = 'Clear'
      const answer = await vscode.window.showWarningMessage(
        `Delete all ${count} annotation${count === 1 ? '' : 's'}?`,
        { modal: true },
        clear,
      )
      if (answer !== clear) return
      session.annotations = []
      persist()
      for (const thread of threads) thread.dispose()
      threads.clear()
    }),

    vscode.commands.registerCommand('slick.editAnnotation', (note: Note) => setMode(note, vscode.CommentMode.Editing)),

    vscode.commands.registerCommand('slick.saveAnnotation', (note: Note) => {
      const annotation = find(note)
      const body = typeof note.body === 'string' ? note.body : note.body.value
      if (!annotation || !body.trim()) return
      annotation.body = body
      persist()
      setMode(note, vscode.CommentMode.Preview, body)
    }),

    vscode.commands.registerCommand('slick.cancelEdit', (note: Note) =>
      setMode(note, vscode.CommentMode.Preview, find(note)?.body),
    ),

    vscode.commands.registerCommand('slick.deleteAnnotation', (note: Note) => {
      const thread = threadOf(note)
      if (!thread) return
      session.annotations = session.annotations.filter((a) => a.id !== note.id)
      persist()
      thread.comments = thread.comments.filter((c) => (c as Note).id !== note.id)
      if (thread.comments.length === 0) {
        threads.delete(thread)
        thread.dispose()
      }
    }),
  )
}

export function deactivate() {}

function toNote(annotation: Annotation): Note {
  return {
    id: annotation.id,
    body: annotation.body,
    mode: vscode.CommentMode.Preview,
    author: { name: 'You' },
    timestamp: new Date(annotation.createdAt),
  }
}

// A selection ending at column 0 of a later line doesn't include that line.
function wholeLines(document: vscode.TextDocument, { start, end }: vscode.Range) {
  const last = end.character === 0 && end.line > start.line ? end.line - 1 : end.line
  return new vscode.Range(start.line, 0, last, document.lineAt(last).range.end.character)
}

function fromRange({ start, end }: vscode.Range): Range {
  return {
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
  }
}

function toRange({ start, end }: Range) {
  return new vscode.Range(start.line, start.character, end.line, end.character)
}
