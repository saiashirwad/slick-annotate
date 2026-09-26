import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { load, save, type Annotation } from './session.ts'

type Note = vscode.Comment & { id: string }
type ThreadInfo = { id: string; snippet: string }

export function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return
  const root = folder.uri.fsPath
  const session = load(root)
  const persist = () => save(root, session)

  const controller = vscode.comments.createCommentController('slick-annotate', 'Slick Annotate')
  const threads = new Map<vscode.CommentThread, ThreadInfo>()

  function openThread(uri: vscode.Uri, range: vscode.Range, info: ThreadInfo, notes: Note[]) {
    const thread = controller.createCommentThread(uri, range, notes)
    thread.canReply = true
    threads.set(thread, info)
    return thread
  }

  function threadOf(note: Note) {
    for (const thread of threads.keys()) {
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

  function dispose(thread: vscode.CommentThread) {
    threads.delete(thread)
    thread.dispose()
  }

  for (const [threadId, annotations] of Map.groupBy(session.annotations, (a) => a.threadId)) {
    const first = annotations[0]
    const thread = openThread(
      vscode.Uri.joinPath(folder.uri, first.file),
      toRange(first.range),
      { id: threadId, snippet: first.snippet },
      annotations.map(toNote),
    )
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed
  }

  context.subscriptions.push(
    controller,

    vscode.commands.registerCommand('slick.annotateSelection', () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const { document, selection } = editor
      const range = selection.isEmpty ? document.lineAt(selection.active.line).range : selection
      const thread = openThread(document.uri, range, { id: randomUUID(), snippet: document.getText(range) }, [])
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded
    }),

    vscode.commands.registerCommand('slick.annotate', (reply: vscode.CommentReply) => {
      const { thread, text } = reply
      const info = threads.get(thread)
      if (!info || !thread.range || !text.trim()) return
      const annotation: Annotation = {
        id: randomUUID(),
        threadId: info.id,
        file: vscode.workspace.asRelativePath(thread.uri, false),
        range: fromRange(thread.range),
        snippet: info.snippet,
        body: text,
        createdAt: new Date().toISOString(),
      }
      session.annotations.push(annotation)
      persist()
      thread.comments = [...thread.comments, toNote(annotation)]
    }),

    vscode.commands.registerCommand('slick.discardThread', (thread: vscode.CommentThread) => {
      if (thread.comments.length === 0) dispose(thread)
    }),

    vscode.commands.registerCommand('slick.editAnnotation', (note: Note) => {
      setMode(note, vscode.CommentMode.Editing)
    }),

    vscode.commands.registerCommand('slick.saveAnnotation', (note: Note) => {
      const annotation = session.annotations.find((a) => a.id === note.id)
      const body = typeof note.body === 'string' ? note.body : note.body.value
      if (!annotation || !body.trim()) return
      annotation.body = body
      persist()
      setMode(note, vscode.CommentMode.Preview, body)
    }),

    vscode.commands.registerCommand('slick.cancelEdit', (note: Note) => {
      const annotation = session.annotations.find((a) => a.id === note.id)
      setMode(note, vscode.CommentMode.Preview, annotation?.body)
    }),

    vscode.commands.registerCommand('slick.deleteAnnotation', (note: Note) => {
      const thread = threadOf(note)
      if (!thread) return
      session.annotations = session.annotations.filter((a) => a.id !== note.id)
      persist()
      thread.comments = thread.comments.filter((c) => (c as Note).id !== note.id)
      if (thread.comments.length === 0) dispose(thread)
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

function fromRange({ start, end }: vscode.Range): Annotation['range'] {
  return {
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
  }
}

function toRange({ start, end }: Annotation['range']) {
  return new vscode.Range(start.line, start.character, end.line, end.character)
}
