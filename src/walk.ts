import * as vscode from 'vscode'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as v from 'valibot'
import { locate } from './locate.ts'
import { revisionText } from './git.ts'
import { setCheck } from './walk-check.ts'
import { documentRange, preparePlaces, revisionScheme, type ResolvedPlace } from './walk-places.ts'
import { errorMessage } from './errors.ts'
import {
  emptyReview,
  fitReview,
  formatReview,
  loadReview,
  removeReview,
  reviewPath,
  saveReview,
  setNote,
  type Review,
} from './review.ts'
import { normalizeProgress, Progress, Walk } from './walk-data.ts'
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
  let highlightedFile: vscode.Uri | undefined
  let highlightedRange: vscode.Range | undefined
  let view: vscode.WebviewView | undefined
  let documentId = 0
  // Each bumped on a new request, so an older one still awaiting a file gives way.
  let highlightRequest = 0
  let loadRequest = 0
  let places = new Map<string, ResolvedPlace[]>()
  let contents = new Map<string, string>()
  let pendingReveal: string | undefined

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

    const state: ToPage = {
      focusedStep: focused?.id ?? null,
      opened: progress.opened,
      notes: review.notes,
      places: [...places].map(([id, items]) => ({
        id,
        items: items.map((place) => ({
          ready: place.uri !== undefined,
          reason: place.reason,
          comparison: place.comparison,
        })),
      })),
      scroll,
    }

    void view?.webview.postMessage(state)

    if (view) view.description = focused ? `${stepIndex(focused.id) + 1} of ${count}` : undefined
  }

  async function refreshStepHighlight() {
    const request = ++highlightRequest
    const step = focusedStep()
    const place = step && places.get(step.id)?.[0]
    highlightedFile = place?.uri
    highlightedRange = undefined
    decorate()

    if (!highlightedFile || !place) return

    try {
      const document = await vscode.workspace.openTextDocument(highlightedFile)

      if (request !== highlightRequest) return
      highlightedRange = documentRange(document, place.range)
      decorate()

      return { request, document, place, range: highlightedRange }
    } catch (error) {
      if (request === highlightRequest) vscode.window.showWarningMessage(`Can't open this step: ${errorMessage(error)}`)
    }
  }

  async function revealFocusedStep() {
    const step = focusedStep()
    pendingReveal = step && !places.get(step.id)?.[0]?.uri ? step.id : undefined
    const located = await refreshStepHighlight()

    if (!located) return
    const { request, document, place, range } = located

    if (place.reason) vscode.window.setStatusBarMessage(place.reason, 4000)

    try {
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: true })

      if (request !== highlightRequest || !range) return
      editor.selection = new vscode.Selection(range.start, range.start)
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    } catch (error) {
      vscode.window.showWarningMessage(`Can't show this step: ${errorMessage(error)}`)
    }
  }

  async function openCode(file: string, quote: string | undefined) {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, file))
      const found = quote === undefined ? undefined : locate(document.getText(), quote)

      if (found && !found.range) explain(found.count, file)
      await vscode.window.showTextDocument(document, {
        preserveFocus: true,
        selection: documentRange(document, found?.range),
      })
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

  function revisionContent(uri: vscode.Uri) {
    const prepared = contents.get(uri.toString())

    if (prepared !== undefined) return prepared
    const query = new URLSearchParams(uri.query)

    if (query.get('empty') === 'true') return ''
    const repo = query.get('repo')
    const revision = query.get('revision')
    const file = query.get('file')

    if (!repo || !revision || !/^[a-f0-9]{40,64}$/.test(revision) || !file) throw new Error('Invalid revision document')

    return revisionText(repo, revision, file)
  }

  async function openPlace(id: string, index: number) {
    const place = places.get(id)?.[index]

    if (!place?.uri) return

    try {
      const document = await vscode.workspace.openTextDocument(place.uri)

      if (place.reason) vscode.window.setStatusBarMessage(place.reason, 4000)
      await vscode.window.showTextDocument(document, {
        preserveFocus: true,
        selection: documentRange(document, place.range),
      })
    } catch (error) {
      vscode.window.showWarningMessage(`Can't open place: ${errorMessage(error)}`)
    }
  }

  async function openDiff(id: string, index: number) {
    const place = places.get(id)?.[index]
    const source = walk?.steps[stepIndex(id)]?.places[index]

    if (!source || !place?.before || !place.after) return

    try {
      const document = await vscode.workspace.openTextDocument(place.after)
      await vscode.commands.executeCommand('vscode.diff', place.before, place.after, source.file, {
        preview: true,
        preserveFocus: true,
        selection: documentRange(document, place.reveal),
      })

      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() !== place.before.toString()) continue
        const range = documentRange(editor.document, place.beforeRange)

        if (range) editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      }
    } catch (error) {
      vscode.window.showWarningMessage(`Can't open comparison: ${errorMessage(error)}`)
    }
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

  function check(id: string, ok: boolean) {
    const next = walk && setCheck(review, walk, id, ok)

    if (next) commitReview(next)
  }

  // Stamps the review as handed over and returns it as text, or nothing if it couldn't be saved.
  function submit() {
    if (!walk || !commitReview({ ...review, title: walk.title, submitted: new Date().toISOString() })) return

    return formatReview(review, walk)
  }

  function showWalk(next: Walk | undefined, html: string[]) {
    walk = next
    sections = html
    problem = undefined
    contents = new Map()
    pendingReveal = undefined
    places = new Map(
      next?.steps.map((step) => [
        step.id,
        step.places.map(() => ({ comparison: next.compare ? { status: 'pending' as const } : undefined })),
      ]),
    )

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
      html = await Promise.all(
        next?.steps.map((step, index) => renderStep(step, index, next?.check, next?.compare !== undefined)) ?? [],
      )
    } catch (error) {
      if (request !== loadRequest) return
      // Keep showing the last good walk: the agent may be partway through rewriting the file.
      problem = `Can't read .tandem/walk.json: ${errorMessage(error)}`
      renderWalkDocument()
      publishWalkState('reveal')

      return
    }

    if (request !== loadRequest) return
    showWalk(next, html)

    if (!next) return
    const prepared = await preparePlaces(folder.uri.fsPath, next)

    if (walk !== next) return
    places = prepared.places
    contents = prepared.contents
    publishWalkState('none')
    void (pendingReveal === focusedStep()?.id ? revealFocusedStep() : refreshStepHighlight())
  }

  function receive({ documentId: from, action }: FromPage) {
    if (from !== documentId) return

    if ('id' in action && stepIndex(action.id) === -1) return

    if ('place' in action && !walk?.steps[stepIndex(action.id)]?.places[action.place]) return

    switch (action.type) {
      case 'focusStep':
        return focusStep(stepIndex(action.id))
      case 'collapseStep':
        return collapseStep(action.id)
      case 'openCode':
        return void openCode(action.file, action.quote)
      case 'openPlace':
        return void openPlace(action.id, action.place)
      case 'openDiff':
        return void openDiff(action.id, action.place)
      case 'setCheck':
        return check(action.id, action.ok)
      case 'setText':
        return void commitReview(setNote(review, action.id, { text: action.text }))
      case 'ready':
        return publishWalkState('reveal')
    }
  }

  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.tandem/walk.json'))

  context.subscriptions.push(
    highlight,
    watcher,
    vscode.workspace.registerTextDocumentContentProvider(revisionScheme, {
      provideTextDocumentContent: revisionContent,
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

    vscode.commands.registerCommand('tandem.walkNext', () => focusStep(stepIndex(progress.step) + 1)),
    vscode.commands.registerCommand('tandem.walkPrevious', () => focusStep(stepIndex(progress.step) - 1)),
    vscode.commands.registerCommand('tandem.walkCurrent', () => focusStep(stepIndex(progress.step))),
    vscode.commands.registerCommand('tandem.walkUnfocus', unfocus),
    vscode.commands.registerCommand('tandem.walkClear', clear),
  )

  void load()

  return { submit }
}

function explain(count: number, file: string) {
  const where = basename(file)
  const message = count === 0 ? `Quote not found in ${where}` : `Quote matches ${count} places in ${where}`
  vscode.window.setStatusBarMessage(message, 4000)
}
