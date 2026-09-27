// Throwaway Tour player for #6: file-backed, no agent bridge yet.
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type Step = { title: string; body: string; file?: string; quote?: string }

type Tour = { title: string; steps: Step[] }

export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.slick', 'tour.json')
  const mermaid = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'mermaid', 'dist')
  let tour: Tour | undefined
  let current = context.workspaceState.get('slick.tourIndex', 0)
  let active = !context.workspaceState.get('slick.tourEnded', false)
  let place: { uri: vscode.Uri; range: vscode.Range } | undefined
  let revision = 0
  // The whole tour as one document in the sidebar, each step's Markdown rendered by VS Code's own engine.
  let view: vscode.WebviewView | undefined
  let sections: string[] = []
  let error: string | undefined

  const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  })

  function decorate() {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(decoration, place?.uri.toString() === editor.document.uri.toString() ? [place.range] : [])
    }
  }

  function draw() {
    if (!view) return
    view.title = tour?.title ?? 'Tour'
    view.webview.html = page(view.webview, mermaid, tour, sections, error)
  }

  // Tells the document which step is current; `scroll` brings it into view (not when you clicked it yourself).
  function mark(scroll: boolean) {
    void view?.webview.postMessage({ current: active ? current : -1, scroll })

    if (view) view.description = tour && active ? `${current + 1} of ${tour.steps.length}` : undefined
  }

  async function show(navigate: boolean, scroll = true) {
    const version = ++revision
    place = undefined
    decorate()
    void vscode.commands.executeCommand('setContext', 'slick.tourActive', active && !!tour?.steps.length)
    mark(scroll)
    const step = active ? tour?.steps[current] : undefined

    if (!step?.file) return

    try {
      const uri = vscode.Uri.joinPath(folder.uri, step.file)
      const document = await vscode.workspace.openTextDocument(uri)

      if (version !== revision) return

      if (step.quote) {
        const text = document.getText()
        const start = text.indexOf(step.quote)

        if (start !== -1 && text.indexOf(step.quote, start + 1) === -1) {
          const end = document.positionAt(start + step.quote.length)
          const last = end.character === 0 && end.line > document.positionAt(start).line ? end.line - 1 : end.line
          place = { uri, range: new vscode.Range(document.positionAt(start).line, 0, last, document.lineAt(last).range.end.character) }
        }
      }

      decorate()

      if (!navigate) return
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: true })

      if (version !== revision || !place) return
      editor.selection = new vscode.Selection(place.range.start, place.range.start)
      editor.revealRange(place.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    } catch (e) {
      if (version === revision) void vscode.window.showWarningMessage(`Cannot open this step: ${String(e)}`)
    }
  }

  function go(index: number, scroll = true) {
    if (!tour?.steps.length) return
    current = Math.max(0, Math.min(index, tour.steps.length - 1))
    active = true
    void context.workspaceState.update('slick.tourIndex', current)
    void context.workspaceState.update('slick.tourEnded', false)
    void show(true, scroll)
  }

  async function reload() {
    try {
      tour = undefined
      sections = []
      error = undefined

      if (existsSync(path)) {
        // SAFETY: hand-authored prototype input, assumed to have the documented shape (like session.json).
        tour = JSON.parse(readFileSync(path, 'utf8')) as Tour
        current = Math.max(0, Math.min(current, tour.steps.length - 1))
        void context.workspaceState.update('slick.tourIndex', current)

        sections = await Promise.all(
          tour.steps.map((step) => vscode.commands.executeCommand<string>('markdown.api.render', step.body)),
        )
      }
    } catch (e) {
      tour = undefined
      error = `Invalid .slick/tour.json: ${String(e)}`
    }

    draw()
    void show(false)
  }

  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.slick/tour.json'))
  context.subscriptions.push(
    decoration, watcher,
    vscode.window.registerWebviewViewProvider('slick.tour', {
      resolveWebviewView: (resolved) => {
        view = resolved
        view.webview.options = { enableScripts: true, localResourceRoots: [mermaid] }
        view.webview.onDidReceiveMessage((message: { go?: number; ready?: boolean }) => {
          if (message.go !== undefined) go(message.go)

          if (message.ready) mark(true)
        })
        view.onDidDispose(() => (view = undefined))
        draw()
      },
    }, { webviewOptions: { retainContextWhenHidden: true } }),
    watcher.onDidCreate(reload), watcher.onDidChange(reload), watcher.onDidDelete(reload),
    vscode.window.onDidChangeVisibleTextEditors(decorate),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (place?.uri.toString() === document.uri.toString()) void show(false, false)
    }),
    vscode.commands.registerCommand('slick.tourStep', go),
    vscode.commands.registerCommand('slick.tourNext', () => go(current + 1)),
    vscode.commands.registerCommand('slick.tourPrevious', () => go(current - 1)),
    vscode.commands.registerCommand('slick.tourCurrent', () => go(current)),
    vscode.commands.registerCommand('slick.tourEnd', () => {
      active = false
      void context.workspaceState.update('slick.tourEnded', true)
      void show(false)
    }),
    { dispose: () => { ++revision } },
  )
  void reload()
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

// Mermaid is loaded only when some step has a diagram. VS Code's built-in mermaid extension turns fences into
// `.mermaid` elements; without it they stay code blocks, which the script converts.
function page(webview: vscode.Webview, mermaid: vscode.Uri, tour: Tour | undefined, sections: string[], error: string | undefined) {
  const nonce = randomUUID().replaceAll('-', '')
  const diagrams = sections.some((html) => /class="mermaid"|language-mermaid/.test(html))
  const empty = error ?? 'Copy a tour to .slick/tour.json to begin.'

  const steps = tour?.steps
    .map((step, i) => `<section data-i="${i}">
  <div class="meta"><span class="step">${i + 1}</span>${step.file ? `<span class="source">${escape(step.file)}</span>` : ''}</div>
  <h2>${escape(step.title)}</h2>
  <div class="body">${sections[i] ?? ''}</div>
</section>`)
    .join('\n')

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
<style>
  html, body { margin: 0; }
  body { padding: 8px 12px 40vh; font: 14px/1.75 var(--vscode-font-family); color: var(--vscode-editor-foreground); }
  /* A comfortable line length however wide the sidebar gets. */
  .body { max-width: 68ch; }
  section { margin: 0 -8px 10px; padding: 12px 14px 14px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; }
  section:hover { background: var(--vscode-list-hoverBackground); }
  section.current { border-color: color-mix(in srgb, var(--vscode-focusBorder) 70%, transparent); background: none; cursor: default; }
  /* Only the current step is open. Collapsed by height, not display, so mermaid can still measure hidden diagrams. */
  section:not(.current) { padding-bottom: 8px; }
  section:not(.current) h2 { margin-bottom: 0; }
  section:not(.current) .body { height: 0; overflow: hidden; }
  .body > :last-child { margin-bottom: 0; }
  .meta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .step { min-width: 18px; padding: 0 6px; border-radius: 9px; font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
  section.current .step { color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
  strong { font-weight: 600; color: var(--vscode-editor-foreground); }
  blockquote { margin: 0 0 8px; padding: 6px 12px; border-radius: 4px; border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 30%, transparent); background: color-mix(in srgb, var(--vscode-textLink-foreground) 8%, transparent); }
  blockquote > :last-child { margin-bottom: 0; }
  .source { font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h2 { margin: 4px 0 8px; font-size: 15px; font-weight: 600; line-height: 1.4; }
  h3, h4 { margin: 10px 0 4px; font-size: 14px; font-weight: 600; }
  p, ul, ol, table { margin: 0 0 12px; }
  li + li { margin-top: 4px; }
  ul, ol { padding-left: 20px; }
  /* Inline code: near body size, an accent between the link colour and the text, on a tint of the same hue. */
  code { font-family: var(--vscode-editor-font-family); font-size: 0.93em; line-height: 1; padding: 0.15em 0.35em; border-radius: 4px; color: color-mix(in srgb, var(--vscode-textLink-foreground) 65%, var(--vscode-editor-foreground)); background: color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent); -webkit-box-decoration-break: clone; }
  pre { margin: 0 0 8px; padding: 8px 12px; border-radius: 4px; overflow-x: auto; background: var(--vscode-textCodeBlock-background); }
  pre code { padding: 0; color: inherit; background: none; }
  table { border-collapse: collapse; font-size: 13px; }
  th, td { padding: 4px 10px; border: 1px solid color-mix(in srgb, var(--vscode-foreground) 15%, transparent); text-align: left; }
  th { font-weight: 600; background: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent); }
  tr:nth-child(even) td { background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); }
  a { color: var(--vscode-textLink-foreground); }
  .mermaid { margin: 4px 0 8px; } .mermaid svg { max-width: 100%; height: auto; }
  .hljs-keyword, .hljs-built_in { color: var(--vscode-symbolIcon-keywordForeground); }
  .hljs-string { color: var(--vscode-debugTokenExpression-string); }
  .hljs-number, .hljs-literal { color: var(--vscode-debugTokenExpression-number); }
  .hljs-comment { color: var(--vscode-descriptionForeground); font-style: italic; }
  .hljs-title, .hljs-function { color: var(--vscode-symbolIcon-functionForeground); }
  .hljs-type, .hljs-class { color: var(--vscode-symbolIcon-classForeground); }
  .empty { color: var(--vscode-descriptionForeground); }
</style></head>
<body>${steps ?? `<p class="empty">${escape(empty)}</p>`}
${diagrams ? `<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(mermaid, 'mermaid.min.js'))}"></script>` : ''}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()

  document.addEventListener('click', (event) => {
    const section = event.target.closest('section')

    if (!section || event.target.closest('a') || String(getSelection())) return
    vscode.postMessage({ go: Number(section.dataset.i) })
  })

  window.addEventListener('message', ({ data }) => {
    for (const section of document.querySelectorAll('section')) {
      const current = Number(section.dataset.i) === data.current
      section.classList.toggle('current', current)

      if (current && data.scroll) section.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  })

  for (const code of document.querySelectorAll('code.language-mermaid')) {
    const diagram = document.createElement('div')
    diagram.className = 'mermaid'
    diagram.textContent = code.textContent
    code.closest('pre').replaceWith(diagram)
  }

  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.body.classList.contains('vscode-light') ? 'neutral' : 'dark' })
    mermaid.run().catch(() => {})
  }

  vscode.postMessage({ ready: true })
</script>
</body></html>`
}
