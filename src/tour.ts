import * as vscode from 'vscode'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// `body` is the short explanation shown when the step opens; `details` is the longer one behind "Show more".
// `refs` are other places worth seeing alongside the step's own code.
type Step = { title: string; body: string; details?: string; file?: string; quote?: string; refs?: Ref[] }

type Ref = { file: string; quote?: string; label?: string }

type Rendered = { body: string; details?: string }

type Tour = { title: string; steps: Step[] }

// Plays `.slick/tour.json`: the whole tour as a document in the sidebar, with the current step's code highlighted.
export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.slick', 'tour.json')
  const media = vscode.Uri.joinPath(context.extensionUri, 'media')
  const mermaid = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'mermaid', 'dist')
  let tour: Tour | undefined
  let problem: string | undefined
  // Each step's Markdown as HTML, rendered once per load by VS Code's own Markdown engine.
  let rendered: Rendered[] = []
  let current = context.workspaceState.get('slick.tourStep', 0)
  let ended = context.workspaceState.get('slick.tourEnded', false)
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
    view.webview.html = page(view.webview, media, mermaid, tour, rendered, problem)
  }

  // Tells the document and the keybindings which step is current.
  function mark(jump: boolean) {
    const count = ended ? 0 : (tour?.steps.length ?? 0)
    void vscode.commands.executeCommand('setContext', 'slick.tourLoaded', !!tour)
    void vscode.commands.executeCommand('setContext', 'slick.tourActive', count > 0)
    void view?.webview.postMessage({ current: count > 0 ? current : -1, jump })

    if (view) view.description = count > 0 ? `${current + 1} of ${count}` : undefined
  }

  // Highlights the current step's code; `reveal` also opens it in the editor.
  async function show(reveal: boolean) {
    const version = ++revision
    place = undefined
    decorate()
    const step = ended ? undefined : tour?.steps[current]

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

  function go(index: number) {
    if (!tour?.steps.length) return
    current = Math.max(0, Math.min(index, tour.steps.length - 1))
    ended = false
    void context.workspaceState.update('slick.tourStep', current)
    void context.workspaceState.update('slick.tourEnded', false)
    mark(false)
    void show(true)
  }

  function end() {
    ended = true
    void context.workspaceState.update('slick.tourEnded', true)
    mark(false)
    void show(false)
  }

  async function clear() {
    const answer = await vscode.window.showWarningMessage('Delete the tour?', { modal: true }, 'Delete')

    if (answer !== 'Delete') return
    current = 0
    ended = false
    void context.workspaceState.update('slick.tourStep', 0)
    void context.workspaceState.update('slick.tourEnded', false)
    // The watcher sees the file go and reloads.
    rmSync(path, { force: true })
  }

  async function load() {
    tour = undefined
    problem = undefined
    rendered = []

    try {
      if (existsSync(path)) {
        // SAFETY: the tour file is written by an agent to the documented shape, like session.json.
        tour = JSON.parse(readFileSync(path, 'utf8')) as Tour
        current = Math.max(0, Math.min(current, tour.steps.length - 1))

        rendered = await Promise.all(
          tour.steps.map(async (step) => ({
            body: await render(step.body),
            details: step.details === undefined ? undefined : await render(step.details),
          })),
        )
      }
    } catch (error) {
      tour = undefined
      problem = `Can't read .slick/tour.json: ${String(error)}`
    }

    draw()
    mark(true)
    void show(false)
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
          view.webview.options = { enableScripts: true, localResourceRoots: [media, mermaid] }

          view.webview.onDidReceiveMessage((message: { go?: number; open?: string; ready?: boolean }) => {
            if (message.go !== undefined) go(message.go)

            if (message.open !== undefined) void open(message.open)

            if (message.ready) mark(true)
          })

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
    vscode.commands.registerCommand('slick.tourEnd', end),
    vscode.commands.registerCommand('slick.tourClear', clear),
  )

  void load()
}

const render = (markdown: string) => vscode.commands.executeCommand<string>('markdown.api.render', markdown)

// The whole lines covering `quote`, if it occurs exactly once in the document.
function locate(document: vscode.TextDocument, quote: string) {
  const text = document.getText()
  const start = text.indexOf(quote)

  if (start === -1 || text.indexOf(quote, start + 1) !== -1) return
  const first = document.positionAt(start).line
  const end = document.positionAt(start + quote.length)
  // A quote ending with a newline stops at column 0 of the next line, which it doesn't include.
  const last = end.character === 0 && end.line > first ? end.line - 1 : end.line

  return new vscode.Range(first, 0, last, document.lineAt(last).range.end.character)
}

// A ref is the same kind of link the text can hold: `file#quote`.
function link({ file, quote, label }: Ref) {
  const href = quote ? `${file}#${encodeURIComponent(quote)}` : file

  return `<a class="ref" href="${escape(href)}">${escape(label ?? file)}</a>`
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

function page(
  webview: vscode.Webview,
  media: vscode.Uri,
  mermaid: vscode.Uri,
  tour: Tour | undefined,
  rendered: Rendered[],
  problem: string | undefined,
) {
  const asset = (root: vscode.Uri, file: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, file))
  const diagrams = rendered.some(({ body, details }) => `${body}${details}`.includes('class="mermaid"'))

  const content = tour
    ? tour.steps
        .map(
          (step, index) => `<section data-index="${index}">
  <div class="meta"><span class="number">${index + 1}</span>${step.file ? `<span class="file">${escape(step.file)}</span>` : ''}</div>
  <h2>${escape(step.title)}</h2>
  <div class="body">
    ${rendered[index]?.body ?? ''}
    ${step.refs?.length ? `<div class="refs">${step.refs.map(link).join('')}</div>` : ''}
    ${rendered[index]?.details ? `<div class="details">${rendered[index].details}</div><button class="more">Show more</button>` : ''}
  </div>
</section>`,
        )
        .join('\n')
    : `<p class="empty">${escape(problem ?? 'No tour yet. An agent writes one to .slick/tour.json.')}</p>`

  // Mermaid draws its diagrams with inline styles, hence 'unsafe-inline' for styles only.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${asset(media, 'tour.css')}">
</head>
<body>
${content}
${diagrams ? `<script src="${asset(mermaid, 'mermaid.min.js')}"></script>` : ''}
<script src="${asset(media, 'tour.js')}"></script>
</body>
</html>`
}
