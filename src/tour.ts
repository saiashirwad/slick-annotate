import * as vscode from 'vscode'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { excludeFromGit } from './git.ts'
import { wholeLines } from './lines.ts'

type Step = { title: string; body: string; details?: string; file?: string; quote?: string; refs?: Ref[] }

type Ref = { file: string; quote?: string; label?: string }

type Tour = { title: string; steps: Step[] }

// Where you are in the tour with this title. Another title starts afresh.
type Progress = { title: string; step: number; focused: boolean; opened: number[] }

// Messages to and from media/tour.js. `current` is -1 when no step is focused.
type ToPage = { current: number; jump: boolean }

type FromPage = { go?: number; unfocus?: boolean; open?: string; opened?: number[]; ready?: boolean }

const start = (title: string): Progress => ({ title, step: 0, focused: true, opened: [] })

export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.tandem', 'tour.json')
  const root = context.extensionUri
  let tour: Tour | undefined
  let problem: string | undefined
  let sections: string[] = []
  let progress = context.workspaceState.get('tandem.tour', start(''))
  // The focused step's file, tracked even while its quote isn't found so an edit that fixes it re-highlights.
  let target: vscode.Uri | undefined
  let place: vscode.Range | undefined
  let view: vscode.WebviewView | undefined
  // Bumped by every `show` and every `load` respectively, so an older one still awaiting a file gives way.
  let revision = 0
  let loading = 0

  const highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('tandem.tourHighlight'),
  })

  function decorate() {
    for (const editor of vscode.window.visibleTextEditors) {
      const here = target?.toString() === editor.document.uri.toString()
      editor.setDecorations(highlight, here && place ? [place] : [])
    }
  }

  function draw() {
    if (!view) return
    view.title = tour?.title ?? 'Tour'
    view.webview.html = page(view.webview, root, sections, progress.opened, problem)
  }

  function mark(jump: boolean) {
    const count = tour?.steps.length ?? 0
    const shown = count > 0 && progress.focused
    void vscode.commands.executeCommand('setContext', 'tandem.tourLoaded', !!tour)
    void vscode.commands.executeCommand('setContext', 'tandem.tourActive', count > 0)
    void vscode.commands.executeCommand('setContext', 'tandem.tourFocused', shown)
    void view?.webview.postMessage({ current: shown ? progress.step : -1, jump } satisfies ToPage)

    if (view) view.description = shown ? `${progress.step + 1} of ${count}` : undefined
  }

  async function show(reveal: boolean) {
    const version = ++revision
    const step = progress.focused ? tour?.steps[progress.step] : undefined
    target = step?.file === undefined ? undefined : vscode.Uri.joinPath(folder.uri, step.file)
    place = undefined
    decorate()

    if (!step?.file || !target) return

    try {
      const document = await vscode.workspace.openTextDocument(target)

      if (version !== revision) return
      const found = step.quote === undefined ? undefined : locate(document, step.quote)
      place = found?.range
      decorate()

      if (!reveal) return

      if (found && !found.range) explain(found.count, step.file)
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: true })

      if (version !== revision || !place) return
      editor.selection = new vscode.Selection(place.start, place.start)
      editor.revealRange(place, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    } catch (error) {
      if (version === revision) vscode.window.showWarningMessage(`Can't open this step: ${String(error)}`)
    }
  }

  async function open(link: string) {
    const [file = '', quote] = link.split(/#(.*)/s)

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, file))
      const found = quote ? locate(document, quote) : undefined

      if (found && !found.range) explain(found.count, file)
      await vscode.window.showTextDocument(document, { preserveFocus: true, selection: found?.range })
    } catch (error) {
      vscode.window.showWarningMessage(`Can't open ${file}: ${String(error)}`)
    }
  }

  function remember() {
    void context.workspaceState.update('tandem.tour', progress)
  }

  function go(index: number) {
    if (!tour?.steps.length) return
    progress.focused = true
    progress.step = Math.max(0, Math.min(index, tour.steps.length - 1))
    remember()
    mark(false)
    void show(true)
  }

  function unfocus() {
    progress.focused = false
    remember()
    mark(false)
    void show(false)
  }

  async function clear() {
    const answer = await vscode.window.showWarningMessage('Delete the tour?', { modal: true }, 'Delete')

    if (answer !== 'Delete') return
    progress = start('')
    remember()
    rmSync(path, { force: true })
  }

  async function load() {
    const version = ++loading
    let next: Tour | undefined
    let html: string[] = []

    try {
      // SAFETY: the tour file is written by an agent to the documented shape, like session.json.
      next = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Tour) : undefined

      if (next && !Array.isArray(next.steps)) throw new Error('it has no "steps" list')
      html = await Promise.all(next?.steps.map(section) ?? [])
    } catch (error) {
      if (version !== loading) return
      // Keep showing the last good tour: the agent may be partway through rewriting the file.
      problem = `Can't read .tandem/tour.json: ${String(error)}`
      draw()
      mark(true)

      return
    }

    if (version !== loading) return
    tour = next
    sections = html
    problem = undefined

    if (tour) {
      excludeFromGit(folder.uri.fsPath)

      if (tour.title !== progress.title) progress = start(tour.title)
      progress.step = Math.min(progress.step, Math.max(0, tour.steps.length - 1))
      remember()
    }

    draw()
    mark(true)
    void show(false)
  }

  function receive(message: FromPage) {
    if (message.go !== undefined) go(message.go)

    if (message.unfocus) unfocus()

    if (message.open !== undefined) void open(message.open)

    if (message.opened) {
      progress.opened = message.opened
      remember()
    }

    if (message.ready) mark(true)
  }

  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.tandem/tour.json'))

  context.subscriptions.push(
    highlight,
    watcher,
    watcher.onDidCreate(load),
    watcher.onDidChange(load),
    watcher.onDidDelete(load),

    vscode.window.registerWebviewViewProvider(
      'tandem.tour',
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
      if (target?.toString() === document.uri.toString()) void show(false)
    }),

    vscode.commands.registerCommand('tandem.tourNext', () => go(progress.step + 1)),
    vscode.commands.registerCommand('tandem.tourPrevious', () => go(progress.step - 1)),
    vscode.commands.registerCommand('tandem.tourCurrent', () => go(progress.step)),
    vscode.commands.registerCommand('tandem.tourUnfocus', unfocus),
    vscode.commands.registerCommand('tandem.tourClear', clear),
  )

  void load()
}

// `range` is set only when the quote occurs exactly once.
function locate(document: vscode.TextDocument, quote: string) {
  const text = document.getText()
  const first = text.indexOf(quote)
  let count = 0

  for (let at = first; quote && at !== -1; at = text.indexOf(quote, at + 1)) count++

  const range =
    count === 1
      ? wholeLines(document, new vscode.Range(document.positionAt(first), document.positionAt(first + quote.length)))
      : undefined

  return { range, count }
}

function explain(count: number, file: string) {
  const where = basename(file)
  const message = count === 0 ? `Quote not found in ${where}` : `Quote matches ${count} places in ${where}`
  vscode.window.setStatusBarMessage(message, 4000)
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// VS Code's engine, which also turns mermaid fences into `.mermaid` elements.
const markdown = (text: string) => vscode.commands.executeCommand<string>('markdown.api.render', text)

async function section(step: Step, index: number) {
  const file = step.file ? `<button class="file">${escape(step.file)}</button>` : ''
  const refs = step.refs?.length ? `<div class="refs">${step.refs.map(link).join('')}</div>` : ''
  const [body, rendered] = await Promise.all([markdown(step.body), step.details && markdown(step.details)])
  const details = rendered ? `<div class="details">${rendered}</div>` : ''
  const more = details && '<button class="more">Show more</button>'

  return `<section data-index="${index}">
  <div class="meta"><span class="number">${index + 1}</span>${file}<button class="collapse" title="Collapse"></button></div>
  <h2>${escape(step.title)}</h2>
  <div class="body">${body}${refs}${details}${more}</div>
</section>`
}

function link({ file, quote, label }: Ref) {
  const href = quote ? `${file}#${encodeURIComponent(quote)}` : file

  return `<a class="ref" href="${escape(href)}">${escape(label ?? file)}</a>`
}

function page(
  webview: vscode.Webview,
  root: vscode.Uri,
  sections: string[],
  opened: number[],
  problem: string | undefined,
) {
  const asset = (path: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, path))
  const notice = problem ? `<p class="problem">${escape(problem)}</p>` : ''
  const empty = problem ? '' : '<p class="empty">No tour yet. An agent writes one to .tandem/tour.json.</p>'
  const content = sections.length ? sections.join('\n') : empty
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
<body data-opened="${opened.join(' ')}">
${notice}
${content}
${mermaid}
<script src="${asset('media/tour.js')}"></script>
</body>
</html>`
}
