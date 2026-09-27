// Throwaway Tour player for #6: file-backed, no agent bridge yet.
import * as vscode from 'vscode'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Step = { title: string; body: string; file?: string; quote?: string }

type Tour = { title: string; steps: Step[] }

export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.slick', 'tour.json')
  // The current step's text, shown in VS Code's own Markdown preview beside the code.
  const page = vscode.Uri.joinPath(folder.uri, '.slick', 'step.md')
  let tour: Tour | undefined
  let current = context.workspaceState.get('slick.tourIndex', 0)
  let active = !context.workspaceState.get('slick.tourEnded', false)
  let place: { uri: vscode.Uri; range: vscode.Range } | undefined
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

  async function showText(step: Step) {
    const heading = `${current + 1}/${tour!.steps.length} · ${tour!.title}`
    writeFileSync(page.fsPath, `<sub>${heading}</sub>\n\n# ${step.title}\n\n${step.body}\n`)
    await vscode.commands.executeCommand('markdown.showLockedPreviewToSide', page)
    await vscode.commands.executeCommand('markdown.preview.refresh')
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
    clear()
    update()
    const step = active ? tour?.steps[current] : undefined

    if (!step) return

    try {
      if (!step.file) {
        if (navigate) await showText(step)

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
      await showText(step)
      const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One })

      if (version !== revision || !place) return
      editor.selection = new vscode.Selection(place.range.start, place.range.start)
      editor.revealRange(place.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      decorate()
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
    { dispose: () => { ++revision } },
  )
  reload()
}
