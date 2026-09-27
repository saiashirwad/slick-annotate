// Throwaway Tour player for #6: file-backed, no agent bridge yet.
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type Step = { title: string; body: string; file?: string; quote?: string }

type Tour = { title: string; steps: Step[] }

export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.slick', 'tour.json')
  let tour: Tour | undefined
  let current = context.workspaceState.get('slick.tourIndex', 0)
  let active = !context.workspaceState.get('slick.tourEnded', false)
  let place: { uri: vscode.Uri; range: vscode.Range } | undefined
  // The current step's text, in a small web panel inserted between lines of code (proposed `editorInsets`).
  let card: vscode.WebviewEditorInset | undefined
  let revision = 0
  const changed = new vscode.EventEmitter<void>()

  const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
  })

  const view = vscode.window.createTreeView<Step>('slick.tour', {
    treeDataProvider: {
      onDidChangeTreeData: changed.event,
      getChildren: () => tour?.steps ?? [],
      getTreeItem: (step) => {
        const index = tour!.steps.indexOf(step)
        const item = new vscode.TreeItem(step.title)
        item.id = String(index)
        item.description = active && index === current ? 'Current' : undefined
        item.iconPath = new vscode.ThemeIcon(active && index === current ? 'debug-stackframe' : 'circle-outline')
        item.tooltip = new vscode.MarkdownString(step.body)
        item.command = { command: 'slick.tourStep', title: 'Go to Step', arguments: [index] }

        return item
      },
    },
  })

  function decorate() {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(decoration, place?.uri.toString() === editor.document.uri.toString() ? [place.range] : [])
    }
  }

  function clear() {
    place = undefined
    decorate()
  }

  // Every step's card, rendered by VS Code's own Markdown engine as soon as the tour loads, so moving is instant.
  let pages: Promise<(webview: vscode.Webview) => string>[] = []
  // Heights the cards measured themselves at, by step, so a revisited card opens at exactly the right size.
  let heights: number[] = []

  function render(step: Step, index: number) {
    const meta = `Step ${index + 1} of ${tour!.steps.length}`

    return Promise.resolve(vscode.commands.executeCommand<string>('markdown.api.render', `# ${step.title}\n\n${step.body}`))
      .then((body) => (webview: vscode.Webview) => page(meta, body, webview, context.extensionUri))
  }

  // Opens at an estimated height; the webview measures itself and the panel is rebuilt only if the text overflows.
  function showCard(editor: vscode.TextEditor, line: number, html: (webview: vscode.Webview) => string, step: Step) {
    card?.dispose()
    const index = current

    const open = (height: number) => {
      const inset = vscode.window.createWebviewTextEditorInset(editor, line, height, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'mermaid', 'dist')],
      })

      inset.webview.html = html(inset.webview)

      inset.webview.onDidReceiveMessage((pixels: number) => {
        const fitted = Math.ceil(pixels / lineHeight())
        heights[index] = Math.max(fitted, 1)

        if (inset !== card || fitted <= height) return
        inset.dispose()
        card = open(fitted)
      })

      return inset
    }

    card = open(heights[index] ?? estimate(step))
  }

  function update() {
    const running = active && !!tour?.steps.length
    void vscode.commands.executeCommand('setContext', 'slick.tourActive', running)
    view.title = tour?.title ?? 'Tour Prototype'
    view.message = !tour ? 'Copy a tour to .slick/tour.json to begin.' : !active ? 'Tour ended. Click a step to resume.' : undefined
    changed.fire()
  }

  async function show(navigate: boolean) {
    const version = ++revision

    if (navigate || !active) {
      card?.dispose()
      card = undefined
    }

    clear()
    update()
    const step = active ? tour?.steps[current] : undefined

    if (!step) return

    try {
      if (!step.file) {
        const editor = vscode.window.activeTextEditor

        if (navigate && editor) showCard(editor, 0, await pages[current], step)

        return
      }

      const html = navigate ? await pages[current] : undefined
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

      if (!html) return
      const editor = await vscode.window.showTextDocument(document)

      if (version !== revision) return
      // Reserve the card's space in the same tick the file opens, so the code never jumps. Insets count lines from 1.
      showCard(editor, place ? place.range.end.line + 1 : 0, html, step)

      if (place) {
        editor.selection = new vscode.Selection(place.range.start, place.range.start)
        editor.revealRange(place.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
        decorate()
      }
    } catch (error) {
      if (version === revision) view.message = `Cannot open this step: ${String(error)}`
    }
  }

  function go(index: number) {
    if (!tour?.steps.length) return
    current = Math.max(0, Math.min(index, tour.steps.length - 1))
    active = true
    void context.workspaceState.update('slick.tourIndex', current)
    void context.workspaceState.update('slick.tourEnded', false)
    void show(true)
  }

  function reload() {
    try {
      tour = undefined

      if (existsSync(path)) {
        // Like session.json, this hand-authored prototype input assumes the documented shape.
        tour = JSON.parse(readFileSync(path, 'utf8'))
        current = Math.max(0, Math.min(current, tour!.steps.length - 1))
        pages = tour!.steps.map(render)
        heights = []
        void context.workspaceState.update('slick.tourIndex', current)
      }

      void show(false)
    } catch (error) {
      tour = undefined
      ++revision
      clear()
      update()
      view.message = `Invalid .slick/tour.json: ${String(error)}`
    }
  }

  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.slick/tour.json'))
  context.subscriptions.push(
    decoration, view, changed, watcher,
    watcher.onDidCreate(reload), watcher.onDidChange(reload), watcher.onDidDelete(reload),
    vscode.window.onDidChangeVisibleTextEditors(decorate),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (place?.uri.toString() === document.uri.toString()) void show(false)
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
    { dispose: () => { ++revision; card?.dispose() } },
  )
  reload()
}

// Card height in editor lines, from the same metrics as the CSS below: roughly 80 characters per text line.
function estimate(step: Step) {
  // A diagram is guessed at 280px; everything else by paragraph length at roughly 90 characters per line.
  const diagrams = step.body.match(/```mermaid[\s\S]*?```/g) ?? []
  const text = step.body.replace(/```mermaid[\s\S]*?```/g, '')
  const paragraphs = text.split(/\n\s*\n/)
  const lines = paragraphs.reduce((sum, paragraph) => sum + paragraph.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0), 0)
  const pixels = 12 + 20 + 30 + lines * 22.4 + 8 * paragraphs.length + 22 + diagrams.length * 280

  // One spare line, so an estimate that falls a little short doesn't force a rebuild.
  return Math.ceil(pixels / lineHeight()) + 1
}

// Pixels per editor line, following VS Code's rules for `editor.lineHeight`.
function lineHeight() {
  const config = vscode.workspace.getConfiguration('editor')
  const fontSize = config.get<number>('fontSize', 14)
  const height = config.get<number>('lineHeight', 0)

  if (height <= 0) return Math.round(fontSize * 1.5)

  return height < 8 ? fontSize * height : height
}

// Mermaid is only loaded into cards that have a diagram; the card reports its height once diagrams have drawn.
function page(meta: string, body: string, webview: vscode.Webview, root: vscode.Uri) {
  const nonce = randomUUID().replaceAll('-', '')
  // VS Code's built-in mermaid extension turns fences into `.mermaid` elements; without it they stay code blocks.
  const diagrams = /class="mermaid"|language-mermaid/.test(body)
  const mermaid = webview.asWebviewUri(vscode.Uri.joinPath(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'))

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { margin: 0; background: transparent; }
  body { padding: 4px 0 8px; font: 14px/1.6 var(--vscode-font-family); color: var(--vscode-editor-foreground); }
  .card { max-width: 80ch; padding: 10px 16px 12px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35))); border-radius: 6px; background: var(--vscode-editorWidget-background); }
  .card { animation: in 180ms ease-out both; }
  @keyframes in { from { opacity: 0; } }
  .meta { font-size: 12px; opacity: 0.6; }
  h1 { margin: 2px 0 6px; font-size: 16px; font-weight: 600; }
  h2, h3, h4 { margin: 10px 0 4px; font-size: 14px; font-weight: 600; }
  p, ul, ol, table { margin: 0 0 8px; } .card > :last-child { margin-bottom: 0; }
  ul, ol { padding-left: 20px; }
  code { font: 0.9em var(--vscode-editor-font-family); padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
  pre { margin: 0 0 8px; padding: 8px 12px; border-radius: 4px; overflow-x: auto; background: var(--vscode-textCodeBlock-background); }
  pre code { padding: 0; background: none; }
  table { border-collapse: collapse; font-size: 13px; }
  th, td { padding: 3px 10px; border: 1px solid var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.35)); text-align: left; }
  a { color: var(--vscode-textLink-foreground); }
  .mermaid { margin: 4px 0 8px; } .mermaid svg { max-width: 100%; height: auto; }
  .hljs-keyword, .hljs-built_in { color: var(--vscode-symbolIcon-keywordForeground); }
  .hljs-string { color: var(--vscode-debugTokenExpression-string); }
  .hljs-number, .hljs-literal { color: var(--vscode-debugTokenExpression-number); }
  .hljs-comment { color: var(--vscode-descriptionForeground); font-style: italic; }
  .hljs-title, .hljs-function { color: var(--vscode-symbolIcon-functionForeground); }
  .hljs-type, .hljs-class { color: var(--vscode-symbolIcon-classForeground); }
</style></head>
<body><div class="card"><div class="meta">${meta.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))}</div>${body}</div>
${diagrams ? `<script nonce="${nonce}" src="${mermaid}"></script>` : ''}
<script nonce="${nonce}">
  const report = () => acquireVsCodeApi().postMessage(document.body.getBoundingClientRect().height)
  for (const code of document.querySelectorAll('code.language-mermaid')) {
    const diagram = document.createElement('div')
    diagram.className = 'mermaid'
    diagram.textContent = code.textContent
    code.closest('pre').replaceWith(diagram)
  }

  if (!document.querySelector('.mermaid') || typeof mermaid === 'undefined') report()
  else {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.body.classList.contains('vscode-light') ? 'neutral' : 'dark' })
    mermaid.run().catch(() => {}).finally(report)
  }
</script>
</body></html>`
}
