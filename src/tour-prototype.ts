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

  // Renders with VS Code's own Markdown engine, then resizes the panel to fit once the webview has measured it.
  async function showCard(editor: vscode.TextEditor, line: number, step: Step) {
    card?.dispose()
    const meta = `${current + 1}/${tour!.steps.length} · ${tour!.title}`
    const html = page(meta, await vscode.commands.executeCommand<string>('markdown.api.render', `# ${step.title}\n\n${step.body}`))

    const open = (height: number) => {
      const inset = vscode.window.createWebviewTextEditorInset(editor, line, height, { enableScripts: true })
      inset.webview.html = html

      inset.webview.onDidReceiveMessage((pixels: number) => {
        const fitted = Math.ceil(pixels / lineHeight())

        if (inset !== card || fitted === height) return
        inset.dispose()
        card = open(fitted)
      })

      return inset
    }

    card = open(Math.min(12, 4 + Math.ceil(step.body.length / 90)))
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

        if (navigate && editor) await showCard(editor, 0, step)

        return
      }

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
      const editor = await vscode.window.showTextDocument(document)

      if (version !== revision) return

      if (place) {
        editor.selection = new vscode.Selection(place.range.start, place.range.start)
        editor.revealRange(place.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
        decorate()
      }

      // Insets count lines from 1, so this sits just under the step's last line.
      await showCard(editor, place ? place.range.end.line + 1 : 0, step)
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

// Pixels per editor line, following VS Code's rules for `editor.lineHeight`.
function lineHeight() {
  const config = vscode.workspace.getConfiguration('editor')
  const fontSize = config.get<number>('fontSize', 14)
  const height = config.get<number>('lineHeight', 0)

  if (height <= 0) return Math.round(fontSize * 1.5)

  return height < 8 ? fontSize * height : height
}

function page(meta: string, body: string) {
  const nonce = randomUUID().replaceAll('-', '')

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  html, body { margin: 0; background: transparent; }
  body { padding: 4px 0 8px; font: 14px/1.6 var(--vscode-font-family); color: var(--vscode-editor-foreground); }
  .card { max-width: 72ch; padding: 10px 16px 12px; border-left: 3px solid var(--vscode-focusBorder); border-radius: 6px; background: var(--vscode-editorWidget-background); }
  .meta { font-size: 12px; opacity: 0.6; }
  h1 { margin: 2px 0 6px; font-size: 16px; font-weight: 600; }
  p, ul, ol { margin: 0 0 8px; } .card > :last-child { margin-bottom: 0; }
  code { font: 0.9em var(--vscode-editor-font-family); padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
  pre { margin: 0 0 8px; padding: 8px 12px; border-radius: 4px; overflow-x: auto; background: var(--vscode-textCodeBlock-background); }
  pre code { padding: 0; background: none; }
  a { color: var(--vscode-textLink-foreground); }
</style></head>
<body><div class="card"><div class="meta">${meta.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))}</div>${body}</div>
<script nonce="${nonce}">acquireVsCodeApi().postMessage(document.body.getBoundingClientRect().height)</script>
</body></html>`
}
