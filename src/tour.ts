import * as vscode from 'vscode'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { excludeFromGit } from './git.ts'
import { wholeLines } from './lines.ts'

type Step = { title: string; body: string; details?: string; file?: string; quote?: string; refs?: Ref[] }

type Ref = { file: string; quote?: string; label?: string }

type Tour = { title: string; steps: Step[] }

// Messages to and from media/tour.js. `current` is -1 when no step is focused.
type ToPage = { current: number; jump: boolean }

type FromPage = { go?: number; unfocus?: boolean; open?: string; ready?: boolean }

export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.slick', 'tour.json')
  const root = context.extensionUri
  let tour: Tour | undefined
  let problem: string | undefined
  let sections: string[] = []
  let current = context.workspaceState.get('slick.tourStep', 0)
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

  function mark(jump: boolean) {
    const count = tour?.steps.length ?? 0
    const shown = count > 0 && focused
    void vscode.commands.executeCommand('setContext', 'slick.tourLoaded', !!tour)
    void vscode.commands.executeCommand('setContext', 'slick.tourActive', count > 0)
    void vscode.commands.executeCommand('setContext', 'slick.tourFocused', shown)
    void view?.webview.postMessage({ current: shown ? current : -1, jump } satisfies ToPage)

    if (view) view.description = shown ? `${current + 1} of ${count}` : undefined
  }

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
    rmSync(path, { force: true })
  }

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

    if (tour) excludeFromGit(folder.uri.fsPath)
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

function locate(document: vscode.TextDocument, quote: string) {
  const text = document.getText()
  const start = text.indexOf(quote)

  if (start === -1 || text.indexOf(quote, start + 1) !== -1) return

  return wholeLines(document, new vscode.Range(document.positionAt(start), document.positionAt(start + quote.length)))
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// VS Code's engine, which also turns mermaid fences into `.mermaid` elements.
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
