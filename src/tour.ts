import * as vscode from 'vscode'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { wholeLines } from './lines.ts'

// `body` is the short explanation shown when the step opens; `details` is the longer one behind "Show more".
// `refs` are other places worth seeing alongside the step's own code.
type Step = { title: string; body: string; details?: string; file?: string; quote?: string; refs?: Ref[] }

type Ref = { file: string; quote?: string; label?: string }

type Tour = { title: string; steps: Step[] }

// The messages between this module and the document's script, media/tour.js.
// To the page: which step is focused (-1 for none), and whether to jump to it instead of keeping it where it is.
type ToPage = { current: number; jump: boolean }

// From the page: focus a step, drop focus, open a link to code, or say it has (re)loaded.
type FromPage = { go?: number; unfocus?: boolean; open?: string; ready?: boolean }

// Plays `.slick/tour.json`: the whole tour as a document in the sidebar, with the current step's code highlighted.
export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.slick', 'tour.json')
  const root = context.extensionUri
  let tour: Tour | undefined
  let problem: string | undefined
  // Each step as HTML for the document, rendered once per load.
  let sections: string[] = []
  let current = context.workspaceState.get('slick.tourStep', 0)
  // Whether `current` is focused: its code highlighted. Closing it in the document unfocuses it.
  let focused = context.workspaceState.get('slick.tourFocused', true)
  let place: { uri: vscode.Uri; range: vscode.Range } | undefined
  let view: vscode.WebviewView | undefined
  // Bumped by every `show`, so an older one still awaiting a file gives way.
  let revision = 0

  const highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('slick.tourHighlight'),
  })

  function decorate() {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(highlight, place?.uri.toString() === editor.document.uri.toString() ? [place.range] : [])
    }
  }

  function draw() {
    if (!view) return
    view.title = tour?.title ?? 'Tour'
    view.webview.html = page(view.webview, root, sections, problem)
  }

  // Tells the document and the keybindings which step is focused.
  function mark(jump: boolean) {
    const count = tour?.steps.length ?? 0
    const shown = count > 0 && focused
    void vscode.commands.executeCommand('setContext', 'slick.tourLoaded', !!tour)
    void vscode.commands.executeCommand('setContext', 'slick.tourActive', count > 0)
    void vscode.commands.executeCommand('setContext', 'slick.tourFocused', shown)
    void view?.webview.postMessage({ current: shown ? current : -1, jump } satisfies ToPage)

    if (view) view.description = shown ? `${current + 1} of ${count}` : undefined
  }

  // Highlights the current step's code; `reveal` also opens it in the editor.
  async function show(reveal: boolean) {
    const version = ++revision
    place = undefined
    decorate()
    const step = focused ? tour?.steps[current] : undefined

    if (!step?.file) return

    try {
      const uri = vscode.Uri.joinPath(folder.uri, step.file)
      const document = await vscode.workspace.openTextDocument(uri)

      if (version !== revision) return
      const range = step.quote === undefined ? undefined : locate(document, step.quote)
      place = range && { uri, range }
      decorate()

      if (!reveal) return
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: true })

      if (version !== revision || !range) return
      editor.selection = new vscode.Selection(range.start, range.start)
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    } catch (error) {
      if (version === revision) vscode.window.showWarningMessage(`Can't open this step: ${String(error)}`)
    }
  }

  // Opens a place the text links to, `file` or `file#quote`, selecting the quote if it occurs exactly once.
  async function open(target: string) {
    const [file = '', quote] = target.split(/#(.*)/s)

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, file))
      const range = quote ? locate(document, quote) : undefined
      await vscode.window.showTextDocument(document, { preserveFocus: true, selection: range })
    } catch (error) {
      vscode.window.showWarningMessage(`Can't open ${file}: ${String(error)}`)
    }
  }

  // Sets which step is current, kept within the tour, and remembers it with whether it's focused.
  function remember(index: number) {
    current = Math.max(0, Math.min(index, (tour?.steps.length ?? 1) - 1))
    void context.workspaceState.update('slick.tourStep', current)
    void context.workspaceState.update('slick.tourFocused', focused)
  }

  function go(index: number) {
    if (!tour?.steps.length) return
    focused = true
    remember(index)
    mark(false)
    void show(true)
  }

  function unfocus() {
    focused = false
    remember(current)
    mark(false)
    void show(false)
  }

  async function clear() {
    const answer = await vscode.window.showWarningMessage('Delete the tour?', { modal: true }, 'Delete')

    if (answer !== 'Delete') return
    focused = true
    remember(0)
    // The watcher sees the file go and reloads.
    rmSync(path, { force: true })
  }

  // Reads and renders the tour first, then swaps it in, so nothing ever sees a tour without its HTML.
  async function load() {
    let next: Tour | undefined
    let html: string[] = []
    problem = undefined

    try {
      // SAFETY: the tour file is written by an agent to the documented shape, like session.json.
      next = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Tour) : undefined
      html = await Promise.all(next?.steps.map(section) ?? [])
    } catch (error) {
      next = undefined
      problem = `Can't read .slick/tour.json: ${String(error)}`
    }

    tour = next
    sections = html
    remember(current)

    draw()
    mark(true)
    void show(false)
  }

  function receive(message: FromPage) {
    if (message.go !== undefined) go(message.go)

    if (message.unfocus) unfocus()

    if (message.open !== undefined) void open(message.open)

    if (message.ready) mark(true)
  }

  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.slick/tour.json'))

  context.subscriptions.push(
    highlight,
    watcher,
    watcher.onDidCreate(load),
    watcher.onDidChange(load),
    watcher.onDidDelete(load),

    // Kept alive while hidden, so switching back to it is instant.
    vscode.window.registerWebviewViewProvider(
      'slick.tour',
      {
        resolveWebviewView: (resolved) => {
          view = resolved
          view.webview.options = { enableScripts: true, localResourceRoots: [root] }
          view.webview.onDidReceiveMessage(receive)

          view.onDidDispose(() => (view = undefined))
          draw()
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),

    vscode.window.onDidChangeVisibleTextEditors(decorate),

    // Edits can move the quoted code, so find it again.
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (place?.uri.toString() === document.uri.toString()) void show(false)
    }),

    vscode.commands.registerCommand('slick.tourNext', () => go(current + 1)),
    vscode.commands.registerCommand('slick.tourPrevious', () => go(current - 1)),
    vscode.commands.registerCommand('slick.tourCurrent', () => go(current)),
    vscode.commands.registerCommand('slick.tourUnfocus', unfocus),
    vscode.commands.registerCommand('slick.tourClear', clear),
  )

  void load()
}

// The whole lines covering `quote`, if it occurs exactly once in the document.
function locate(document: vscode.TextDocument, quote: string) {
  const text = document.getText()
  const start = text.indexOf(quote)

  if (start === -1 || text.indexOf(quote, start + 1) !== -1) return

  return wholeLines(document, new vscode.Range(document.positionAt(start), document.positionAt(start + quote.length)))
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// Markdown to HTML with VS Code's own engine, which also turns mermaid fences into `.mermaid` elements.
const markdown = (text: string) => vscode.commands.executeCommand<string>('markdown.api.render', text)

async function section(step: Step, index: number) {
  const file = step.file ? `<span class="file">${escape(step.file)}</span>` : ''
  const refs = step.refs?.length ? `<div class="refs">${step.refs.map(link).join('')}</div>` : ''
  const details = step.details ? `<div class="details">${await markdown(step.details)}</div>` : ''
  const more = details && '<button class="more">Show more</button>'

  return `<section data-index="${index}">
  <div class="meta"><span class="number">${index + 1}</span>${file}<button class="collapse" title="Collapse"></button></div>
  <h2>${escape(step.title)}</h2>
  <div class="body">${await markdown(step.body)}${refs}${details}${more}</div>
</section>`
}

// A ref is the same kind of link the text can hold: `file#quote`.
function link({ file, quote, label }: Ref) {
  const href = quote ? `${file}#${encodeURIComponent(quote)}` : file

  return `<a class="ref" href="${escape(href)}">${escape(label ?? file)}</a>`
}

function page(webview: vscode.Webview, root: vscode.Uri, sections: string[], problem: string | undefined) {
  const asset = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, path))
  const empty = problem ?? 'No tour yet. An agent writes one to .slick/tour.json.'
  const content = sections.length ? sections.join('\n') : `<p class="empty">${escape(empty)}</p>`
  const diagrams = content.includes('class="mermaid"')
  const mermaid = diagrams ? `<script src="${asset('node_modules/mermaid/dist/mermaid.min.js')}"></script>` : ''
  // Mermaid draws its diagrams with inline styles, hence 'unsafe-inline' for styles only.
  const source = webview.cspSource
  const csp = `default-src 'none'; img-src ${source} data:; style-src ${source} 'unsafe-inline'; script-src ${source};`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${asset('media/tour.css')}">
</head>
<body>
${content}
${mermaid}
<script src="${asset('media/tour.js')}"></script>
</body>
</html>`
}
