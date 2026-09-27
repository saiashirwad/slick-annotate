import * as vscode from 'vscode'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as v from 'valibot'
import { wholeLines } from './lines.ts'
import { errorMessage } from './errors.ts'
import { normalizeProgress, Progress, Tour } from './tour-data.ts'
import { FromPage, type ToPage } from './tour-messages.ts'
import { page, renderStep } from './tour-page.ts'

export function activateTour(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.tandem', 'tour.json')
  const root = context.extensionUri
  let tour: Tour | undefined
  let problem: string | undefined
  let sections: string[] = []
  const saved = v.safeParse(Progress, context.workspaceState.get('tandem.tour'))
  let progress = saved.success ? saved.output : normalizeProgress(undefined, undefined)
  // The focused step's file, tracked even while its quote isn't found so an edit that fixes it re-highlights.
  let highlightedFile: vscode.Uri | undefined
  let highlightedRange: vscode.Range | undefined
  let view: vscode.WebviewView | undefined
  let documentId = 0
  // Each bumped on a new request, so an older one still awaiting a file gives way.
  let highlightRequest = 0
  let loadRequest = 0

  const highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('tandem.tourHighlight'),
  })

  function decorate() {
    for (const editor of vscode.window.visibleTextEditors) {
      const here = highlightedFile?.toString() === editor.document.uri.toString()
      editor.setDecorations(highlight, here && highlightedRange ? [highlightedRange] : [])
    }
  }

  function focusedStep() {
    return progress.focused ? tour?.steps[progress.step] : undefined
  }

  function renderTourDocument() {
    if (!view) return
    view.title = tour?.title ?? 'Tour'
    view.webview.html = page(view.webview, root, ++documentId, sections, progress.opened, problem)
  }

  function publishTourState(scroll: ToPage['scroll']) {
    const count = tour?.steps.length ?? 0
    const focused = focusedStep() ? progress.step : null
    void vscode.commands.executeCommand('setContext', 'tandem.tourLoaded', !!tour)
    void vscode.commands.executeCommand('setContext', 'tandem.tourActive', count > 0)
    void vscode.commands.executeCommand('setContext', 'tandem.tourFocused', focused !== null)
    void view?.webview.postMessage({ focusedStep: focused, opened: progress.opened, scroll } satisfies ToPage)

    if (view) view.description = focused === null ? undefined : `${focused + 1} of ${count}`
  }

  // Highlights the focused step's code without showing it. Returns what it found, unless a newer request took over.
  async function refreshStepHighlight() {
    const request = ++highlightRequest
    const step = focusedStep()
    highlightedFile = step?.file === undefined ? undefined : vscode.Uri.joinPath(folder.uri, step.file)
    highlightedRange = undefined
    decorate()

    if (!step?.file || !highlightedFile) return

    try {
      const document = await vscode.workspace.openTextDocument(highlightedFile)

      if (request !== highlightRequest) return
      const found = step.quote === undefined ? undefined : locate(document, step.quote)
      highlightedRange = found?.range
      decorate()

      return { request, document, found, file: step.file }
    } catch (error) {
      if (request === highlightRequest) vscode.window.showWarningMessage(`Can't open this step: ${errorMessage(error)}`)
    }
  }

  async function revealFocusedStep() {
    const located = await refreshStepHighlight()

    if (!located) return
    const { request, document, found, file } = located

    if (found && !found.range) explain(found.count, file)

    try {
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: true })

      if (request !== highlightRequest || !found?.range) return
      editor.selection = new vscode.Selection(found.range.start, found.range.start)
      editor.revealRange(found.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    } catch (error) {
      vscode.window.showWarningMessage(`Can't show this step: ${errorMessage(error)}`)
    }
  }

  async function openCode(file: string, quote: string | undefined) {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, file))
      const found = quote === undefined ? undefined : locate(document, quote)

      if (found && !found.range) explain(found.count, file)
      await vscode.window.showTextDocument(document, { preserveFocus: true, selection: found?.range })
    } catch (error) {
      vscode.window.showWarningMessage(`Can't open ${file}: ${errorMessage(error)}`)
    }
  }

  // Progress is the reader's place, not a record: it's accepted at once, and a failed write only loses it on reload.
  function setProgress(next: Progress) {
    progress = next
    context.workspaceState.update('tandem.tour', next).then(undefined, (error) => {
      vscode.window.setStatusBarMessage(`Couldn't remember your place in the tour: ${errorMessage(error)}`, 4000)
    })
  }

  // Every change of place goes through here, so the page, the context keys and the highlight never fall behind it.
  function moveTo(next: Progress, scroll: ToPage['scroll'], reveal = false) {
    setProgress(next)
    publishTourState(scroll)
    void (reveal ? revealFocusedStep() : refreshStepHighlight())
  }

  function focusStep(index: number) {
    if (!tour?.steps.length) return
    const step = Math.max(0, Math.min(index, tour.steps.length - 1))
    moveTo({ ...progress, step, focused: true, opened: [...new Set([...progress.opened, step])] }, 'preserve', true)
  }

  function unfocus() {
    moveTo({ ...progress, focused: false }, 'preserve')
  }

  function collapseStep(index: number) {
    const focused = progress.focused && progress.step !== index
    moveTo({ ...progress, focused, opened: progress.opened.filter((opened) => opened !== index) }, 'preserve')
  }

  function showTour(next: Tour | undefined, html: string[]) {
    tour = next
    sections = html
    problem = undefined

    // Progress outlives a missing file, so a tour rewritten by delete-and-create keeps your place.
    if (tour) progress = normalizeProgress(progress, tour)

    renderTourDocument()
    moveTo(progress, 'reveal')
  }

  async function clear() {
    const answer = await vscode.window.showWarningMessage('Delete the tour?', { modal: true }, 'Delete')

    if (answer !== 'Delete') return

    try {
      rmSync(path, { force: true })
    } catch (error) {
      vscode.window.showWarningMessage(`Can't delete .tandem/tour.json: ${errorMessage(error)}`)

      return
    }

    loadRequest++
    progress = normalizeProgress(undefined, undefined)
    showTour(undefined, [])
  }

  async function load() {
    const request = ++loadRequest
    let next: Tour | undefined
    let html: string[]

    try {
      next = existsSync(path) ? v.parse(Tour, JSON.parse(readFileSync(path, 'utf8'))) : undefined
      html = await Promise.all(next?.steps.map(renderStep) ?? [])
    } catch (error) {
      if (request !== loadRequest) return
      // Keep showing the last good tour: the agent may be partway through rewriting the file.
      problem = `Can't read .tandem/tour.json: ${errorMessage(error)}`
      renderTourDocument()
      publishTourState('reveal')

      return
    }

    if (request === loadRequest) showTour(next, html)
  }

  function receive({ documentId: from, action }: FromPage) {
    if (from !== documentId) return

    switch (action.type) {
      case 'focusStep':
        return focusStep(action.index)
      case 'collapseStep':
        return collapseStep(action.index)
      case 'openCode':
        return void openCode(action.file, action.quote)
      case 'ready':
        return publishTourState('reveal')
    }
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
          view.webview.onDidReceiveMessage((message) => {
            const parsed = v.safeParse(FromPage, message)

            if (parsed.success) receive(parsed.output)
          })

          view.onDidDispose(() => (view = undefined))
          renderTourDocument()
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),

    vscode.window.onDidChangeVisibleTextEditors(decorate),

    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (highlightedFile?.toString() === document.uri.toString()) void refreshStepHighlight()
    }),

    vscode.commands.registerCommand('tandem.tourNext', () => focusStep(progress.step + 1)),
    vscode.commands.registerCommand('tandem.tourPrevious', () => focusStep(progress.step - 1)),
    vscode.commands.registerCommand('tandem.tourCurrent', () => focusStep(progress.step)),
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
