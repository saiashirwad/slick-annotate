import * as vscode from 'vscode'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as v from 'valibot'
import { wholeLines } from './lines.ts'
import { errorMessage } from './errors.ts'
import {
  emptyReview,
  fitReview,
  formatReview,
  loadReview,
  removeReview,
  reviewPath,
  saveReview,
  setApproval,
  setResponse,
  type Review,
} from './review.ts'
import { normalizeProgress, Progress, Walk } from './walk-data.ts'
import { diffSides } from './walk-diff.ts'
import { FromPage, type ToPage } from './walk-messages.ts'
import { page, renderStep } from './walk-page.ts'

export function activateWalk(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
  const path = join(folder.uri.fsPath, '.tandem', 'walk.json')
  const root = context.extensionUri
  let walk: Walk | undefined
  let problem: string | undefined
  let sections: string[] = []
  const saved = v.safeParse(Progress, context.workspaceState.get('tandem.walk'))
  let progress = saved.success ? saved.output : normalizeProgress(undefined, undefined)
  let review = emptyReview('')
  // Set while review.json can't be read; the review is then left alone rather than overwritten.
  let reviewProblem: string | undefined
  // The focused step's file, tracked even while its quote isn't found so an edit that fixes it re-highlights.
  let highlightedFile: vscode.Uri | undefined
  let highlightedRange: vscode.Range | undefined
  let view: vscode.WebviewView | undefined
  let documentId = 0
  // Each bumped on a new request, so an older one still awaiting a file gives way.
  let highlightRequest = 0
  let loadRequest = 0

  try {
    review = loadReview(folder.uri.fsPath)
  } catch (error) {
    reviewProblem = `Your review is off until .tandem/review.json is fixed or the walk cleared: ${errorMessage(error)}`
  }

  const highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('tandem.walkHighlight'),
  })

  function decorate() {
    for (const editor of vscode.window.visibleTextEditors) {
      const here = highlightedFile?.toString() === editor.document.uri.toString()
      editor.setDecorations(highlight, here && highlightedRange ? [highlightedRange] : [])
    }
  }

  function stepIndex(id: string) {
    return walk?.steps.findIndex((step) => step.id === id) ?? -1
  }

  function focusedStep() {
    return progress.focused ? walk?.steps[stepIndex(progress.step)] : undefined
  }

  function renderWalkDocument() {
    if (!view) return
    view.title = walk?.title ?? 'Walk'
    const problems = [problem, reviewProblem].filter((text) => text !== undefined)
    view.webview.html = page(view.webview, root, ++documentId, sections, progress.opened, problems)
  }

  function publishWalkState(scroll: ToPage['scroll']) {
    const count = walk?.steps.length ?? 0
    const focused = focusedStep()
    void vscode.commands.executeCommand('setContext', 'tandem.walkLoaded', !!walk)
    void vscode.commands.executeCommand('setContext', 'tandem.walkActive', count > 0)
    void vscode.commands.executeCommand('setContext', 'tandem.walkFocused', !!focused)
    void vscode.commands.executeCommand('setContext', 'tandem.walkProposalFocused', !!focused?.proposal)

    const state: ToPage = {
      focusedStep: focused?.id ?? null,
      opened: progress.opened,
      approved: review.steps.filter((entry) => entry.approved).map((entry) => entry.id),
      responses: review.steps.map((entry) => ({ id: entry.id, text: entry.response ?? '' })),
      scroll,
    }

    void view?.webview.postMessage(state)

    if (view) view.description = focused ? `${stepIndex(focused.id) + 1} of ${count}` : undefined
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
    context.workspaceState.update('tandem.walk', next).then(undefined, (error) => {
      vscode.window.setStatusBarMessage(`Couldn't remember your place in the walk: ${errorMessage(error)}`, 4000)
    })
  }

  // Every change of place goes through here, so the page, the context keys and the highlight never fall behind it.
  function moveTo(next: Progress, scroll: ToPage['scroll'], reveal = false) {
    setProgress(next)
    publishWalkState(scroll)
    void (reveal ? revealFocusedStep() : refreshStepHighlight())
  }

  function focusStep(index: number) {
    if (!walk?.steps.length) return
    const { id } = walk.steps[Math.max(0, Math.min(index, walk.steps.length - 1))]
    moveTo({ ...progress, step: id, focused: true, opened: [...new Set([...progress.opened, id])] }, 'preserve', true)
  }

  function unfocus() {
    moveTo({ ...progress, focused: false }, 'preserve')
  }

  function collapseStep(id: string) {
    const focused = progress.focused && progress.step !== id
    moveTo({ ...progress, focused, opened: progress.opened.filter((opened) => opened !== id) }, 'preserve')
  }

  // A proposal's diff opens in VS Code's diff editor as two read-only documents built from it; no file is touched.
  const diffScheme = 'tandem-diff'
  const diffChanged = new vscode.EventEmitter<vscode.Uri>()
  const openedDiffs = new Set<string>()

  function diffContent(uri: vscode.Uri) {
    const query = new URLSearchParams(uri.query)
    const diff = walk?.steps[stepIndex(query.get('id') ?? '')]?.diff

    return diff === undefined ? '' : diffSides(diff)[query.get('side') === 'before' ? 'before' : 'after']
  }

  function openDiff(id: string) {
    const step = walk?.steps[stepIndex(id)]

    if (!step?.diff) return
    const path = `/${step.file ?? 'proposal'}`

    const side = (name: string) =>
      vscode.Uri.from({ scheme: diffScheme, path, query: new URLSearchParams({ id, side: name }).toString() })

    const [before, after] = [side('before'), side('after')]
    openedDiffs.add(before.toString()).add(after.toString())
    void vscode.commands.executeCommand('vscode.diff', before, after, `Proposal: ${step.title}`, { preview: true })
  }

  // Unlike progress, the review is a record the agent reads: it changes only once it's on disk.
  function commitReview(next: Review) {
    if (reviewProblem) {
      vscode.window.showWarningMessage(reviewProblem)

      return false
    }

    try {
      saveReview(folder.uri.fsPath, next)
    } catch (error) {
      vscode.window.showWarningMessage(`Can't save your review: ${errorMessage(error)}`)

      return false
    }

    review = next
    publishWalkState('none')

    return true
  }

  function approve(id: string, approved: boolean) {
    const step = walk?.steps[stepIndex(id)]

    if (step?.proposal) commitReview(setApproval(review, step, approved))
  }

  function respond(id: string, text: string) {
    if (stepIndex(id) !== -1) commitReview(setResponse(review, id, text))
  }

  function toggleApproval() {
    const step = focusedStep()

    if (step) approve(step.id, !review.steps.some((entry) => entry.id === step.id && entry.approved))
  }

  // Stamps the review as handed over and returns it as text, or nothing if it couldn't be saved.
  function submit() {
    if (!walk || !commitReview({ ...review, title: walk.title, submittedAt: new Date().toISOString() })) return

    return formatReview(review, walk)
  }

  function showWalk(next: Walk | undefined, html: string[]) {
    walk = next
    sections = html
    problem = undefined

    // Progress and the review outlive a missing file, so a walk rewritten by delete-and-create keeps both.
    if (walk) {
      progress = normalizeProgress(progress, walk)
      const fitted = fitReview(review, walk)

      if (JSON.stringify(fitted) !== JSON.stringify(review) && existsSync(reviewPath(folder.uri.fsPath))) {
        commitReview(fitted)
      } else if (!reviewProblem) {
        review = fitted
      }
    }

    for (const uri of openedDiffs) diffChanged.fire(vscode.Uri.parse(uri))
    renderWalkDocument()
    moveTo(progress, 'reveal')
  }

  async function clear() {
    const answer = await vscode.window.showWarningMessage(
      'Delete the walk and your review of it?',
      { modal: true },
      'Delete',
    )

    if (answer !== 'Delete') return

    try {
      rmSync(path, { force: true })
      removeReview(folder.uri.fsPath)
    } catch (error) {
      vscode.window.showWarningMessage(`Can't delete the walk: ${errorMessage(error)}`)

      return
    }

    loadRequest++
    progress = normalizeProgress(undefined, undefined)
    review = emptyReview('')
    reviewProblem = undefined
    showWalk(undefined, [])
  }

  async function load() {
    const request = ++loadRequest
    let next: Walk | undefined
    let html: string[]

    try {
      next = existsSync(path) ? v.parse(Walk, JSON.parse(readFileSync(path, 'utf8'))) : undefined
      html = await Promise.all(next?.steps.map(renderStep) ?? [])
    } catch (error) {
      if (request !== loadRequest) return
      // Keep showing the last good walk: the agent may be partway through rewriting the file.
      problem = `Can't read .tandem/walk.json: ${errorMessage(error)}`
      renderWalkDocument()
      publishWalkState('reveal')

      return
    }

    if (request === loadRequest) showWalk(next, html)
  }

  function receive({ documentId: from, action }: FromPage) {
    if (from !== documentId) return

    switch (action.type) {
      case 'focusStep':
        return focusStep(stepIndex(action.id))
      case 'collapseStep':
        return collapseStep(action.id)
      case 'openCode':
        return void openCode(action.file, action.quote)
      case 'openDiff':
        return openDiff(action.id)
      case 'approve':
        return approve(action.id, action.approved)
      case 'respond':
        return respond(action.id, action.text)
      case 'ready':
        return publishWalkState('reveal')
    }
  }

  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.tandem/walk.json'))

  context.subscriptions.push(
    highlight,
    watcher,
    diffChanged,
    vscode.workspace.registerTextDocumentContentProvider(diffScheme, {
      onDidChange: diffChanged.event,
      provideTextDocumentContent: diffContent,
    }),
    watcher.onDidCreate(load),
    watcher.onDidChange(load),
    watcher.onDidDelete(load),

    vscode.window.registerWebviewViewProvider(
      'tandem.walk',
      {
        resolveWebviewView: (resolved) => {
          view = resolved
          view.webview.options = { enableScripts: true, localResourceRoots: [root] }
          view.webview.onDidReceiveMessage((message) => {
            const parsed = v.safeParse(FromPage, message)

            if (parsed.success) receive(parsed.output)
          })

          view.onDidDispose(() => (view = undefined))
          renderWalkDocument()
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),

    vscode.window.onDidChangeVisibleTextEditors(decorate),

    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (highlightedFile?.toString() === document.uri.toString()) void refreshStepHighlight()
    }),

    vscode.commands.registerCommand('tandem.walkNext', () => focusStep(stepIndex(progress.step) + 1)),
    vscode.commands.registerCommand('tandem.walkPrevious', () => focusStep(stepIndex(progress.step) - 1)),
    vscode.commands.registerCommand('tandem.walkCurrent', () => focusStep(stepIndex(progress.step))),
    vscode.commands.registerCommand('tandem.walkUnfocus', unfocus),
    vscode.commands.registerCommand('tandem.walkApprove', toggleApproval),
    vscode.commands.registerCommand('tandem.walkClear', clear),
  )

  void load()

  return { submit }
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
