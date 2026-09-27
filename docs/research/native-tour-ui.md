# Native UI pieces a tour could be built from

Research for #4: an inventory of stable (and relevant proposed) VS Code APIs a guided,
agent-written tour could use **without a webview**, and how each one feels for
stepping through code. Extension targets `engines.vscode: ^1.138.0`
(`package.json`); versions and stability below are checked against
`@types/vscode@1.138.0` (installed in `node_modules/@types/vscode/index.d.ts`)
and the `microsoft/vscode` repo at tag `1.138.0`.

## At a glance

| Piece | Stability | What it looks like | Can't do | Keyboard / focus feel |
|---|---|---|---|---|
| **Comments API threads** | Stable. `thread.reveal()` (focus control) is **proposed** (`commentReveal`, already enabled by this extension) | Inline card under a line/file with author, body (Markdown), reactions, labels | No arbitrary layout; body is one Markdown blob per comment | `reveal(range, {focus})` scrolls in and optionally focuses the reply box or thread; doesn't force keyboard-only "next" — you re-trigger a command to move threads |
| **Comment reactions** | Stable (`CommentReaction`), richer `reactors` list is **proposed** (`commentReactor`) | Small emoji/count pills under a comment, click to toggle | No custom reaction sets beyond what the extension supplies via `reactionHandler` | Mouse-first; not built for pure-keyboard stepping |
| **Comment thread state / applicability** | `CommentThreadState` (resolved/unresolved) stable; `CommentThreadApplicability` (current/outdated) is **proposed** (`commentThreadApplicability`) | Small icon change (e.g. checkmark) on the thread | Not a general status/progress indicator | N/A — purely visual |
| **Text editor decorations** | Stable (`TextEditorDecorationType`, `DecorationRenderOptions`) | Whole-line background/border highlight, gutter icon, `before`/`after` inline text (ghost-text style) | Not interactive by itself — clicks/keys don't hit a decoration; only `hoverMessage` reacts to mouse hover | Fully keyboard-agnostic: decorations don't take focus at all, so a tour can highlight the "current step" line while focus stays wherever the user put it |
| **Reveal / selection** | Stable (`TextEditor.revealRange`, `TextEditorRevealType`, `window.showTextDocument({selection, preserveFocus})`) | Scrolls the code into view, optionally selects a range | No animation/step control beyond the 4 reveal strategies | `preserveFocus: true` scrolls without stealing focus from wherever a tour driver (e.g. a QuickPick) has it; without it, focus moves to the editor |
| **Status bar items** | Stable (`window.createStatusBarItem`, `StatusBarItem`) | Small text (+ optional icon) in the status bar, clickable if given a `command` | One line of text, no rich content beyond a Markdown tooltip | Never steals focus; a natural place for "Step 3 of 8" + Next/Prev commands bound to click or keybinding |
| **TreeView** | Stable (`window.createTreeView`, `TreeView<T>.reveal()` with `select`/`focus`/`expand`) | A panel/sidebar list of steps (title, description, icon, checkbox) | Fixed row-based layout; no free-form step content | `reveal(item, {select, focus})` can move keyboard focus into the tree; arrow keys + Enter navigate steps once focused — good "step list" affordance |
| **CodeLens** | Stable (`languages.registerCodeLensProvider`, `CodeLens`) | A clickable line of text above a line of code, running a command | Only above lines that are "valid" ranges; text-only, no icons/Markdown | Mouse-first (click to run command); no dedicated keyboard nav, though VS Code has generic "Show/Go to CodeLens" commands |
| **Inlay hints** | Stable (`languages.registerInlayHintsProvider`, `InlayHint`) | Small greyed-out text inline in the code (like parameter-name hints) | Purely decorative/informational; not meant as a click target for flow control (though `InlayHintLabelPart` can carry a `command`) | No focus interaction; good for lightweight inline annotation, not for driving a tour |
| **Hover providers** | Stable (`languages.registerHoverProvider`, `Hover`) | Markdown tooltip on mouse hover / `Cmd+K Cmd+I` | Only appears on hover or explicit "Show Hover" command; can't be pushed proactively | Keyboard trigger exists (`editor.action.showHover`) but it's a "look up," not a "next/prev" flow |
| **Peek view** (`editor.action.peekLocations`) | **Undocumented internal command** — not declared in `@types/vscode`; registered as a plain `CommandsRegistry` command in `microsoft/vscode` (`src/vs/editor/contrib/gotoSymbol/browser/goToCommands.ts`), aliased from `editor.action.showReferences`. De facto stable since ~2016 (same command backs "Peek Definition"/"Find All References") but not part of the versioned public API surface | Inline widget below a line: file tree of locations on the left, code preview on the right | Extensions can only feed it single-file-and-position + a list of `Location`s; can't customize its chrome or content beyond that | Opening it **does** move focus into the widget; arrow keys move between locations, `Enter`/double-click jumps and closes, `Escape` closes back to the editor. Good building block for "here are 3 related spots," awkward for a strictly linear tour |
| **Quick picks** | Stable (`window.createQuickPick`, `QuickPick<T>`) | A palette-style list with filter box, buttons, `onDidAccept` | One list at a time; no inline code rendering (only text/description/detail per item) | Always takes focus (modal-ish overlay); `Enter`/arrow keys are native, `Escape` cancels — closest native primitive to a deliberate keyboard-driven "next/prev" stepper |
| **Walkthroughs** (`contributes.walkthroughs`) | Stable contribution point (docs confirm "native UI," no webview) | Getting-Started-style page: steps with title, Markdown description, image/markdown media, "mark done" via `completionEvents` | Static per-extension declaration in `package.json` — steps aren't easily generated at runtime per-repo/session; designed for onboarding, not for pointing at arbitrary live code locations | Steps aren't a keyboard next/prev sequence over your code — it's a separate editor-group page you click into and out of |
| **Notifications** | Stable (`window.showInformationMessage`/`showWarningMessage`, `MessageOptions.modal`) | Toast in the bottom-right, or a modal dialog if `modal: true` | Ephemeral (non-modal ones auto-dismiss); not a place to hold ongoing tour state | Non-modal: never steals focus. Modal: fully steals focus until dismissed |
| **Comments panel** | Stable (built-in "Comments" panel lists every `CommentThread` from every controller) | A flat/grouped list of threads; click to jump to one | Extension doesn't control its layout, only feeds it via the Comments API | Standard panel list keyboard nav (arrows + Enter); same reveal/focus rules as inline threads |
| **Context keys + keybindings** | Stable (`commands.executeCommand('setContext', key, value)`; `contributes.keybindings` `when` clauses) | Invisible — gates which keybinding/menu item is active | Not UI by itself; needs another piece to render anything | This is the plumbing that would let e.g. `Alt+]`/`Alt+[` mean "next/prev tour step" only while a tour is active (`when: "slick.tourActive"`) |

## Notes

### Comments API (the extension's existing base)

- `CommentController`, `CommentThread`, `Comment`, `CommentReaction`, `CommentAuthorInformation`,
  `CommentThreadState`, `CommentThreadCollapsibleState`, `CommentMode` are all stable in
  `@types/vscode@1.138.0` (`node_modules/@types/vscode/index.d.ts`, e.g. `CommentThread` at
  line 17537, `Comment` at line 17648, `CommentController` at line 17761).
- `Comment.body` accepts a `MarkdownString`, and `MarkdownString.isTrusted` (either `true` or
  `{ enabledCommands: [...] }`) is required for `[label](command:id)` links to execute — this is
  exactly the mechanism a tour needs for "Next step" / "Jump to X" links inside a thread body
  (`index.d.ts` line ~3025).
- `Comment.contextValue` / `CommentThread.contextValue` gate per-item menu contributions via
  `when` clauses in `contributes.menus["comments/comment/title"]` etc. (documented inline in
  `index.d.ts` next to each field, lines 17568 and 17666).
- **Stable `CommentThread` has no `reveal()` method.** Scrolling/focusing a thread requires the
  proposed `commentReveal` API: `CommentThreadFocus` enum (`Reply` | `Comment`) and
  `CommentThread2.reveal(comment?, { focus? }): Thenable<void>` plus a `hide()` method
  (`microsoft/vscode` `src/vscode-dts/vscode.proposed.commentReveal.d.ts` at tag `1.138.0`).
  This extension already enables it (`package.json` `enabledApiProposals: ["commentReveal"]`,
  used in `src/extension.ts` as `thread.reveal(undefined, { focus: vscode.CommentThreadFocus.Reply })`),
  confirming SPEC.md's note that whole-file threads are stable but reply-focus is proposed.
- Other comment-related proposals seen at `1.138.0`, not currently used, but relevant to a richer
  tour UI: `activeComment` (`CommentController.activeCommentThread`, tracks focus — useful for
  "where is the user in the tour"), `commentThreadApplicability` (mark a thread "outdated" —
  could flag a tour step whose code has since changed), `commentsDraftState` (`CommentState`
  `Published`/`Draft`), `commentReactor` (who reacted), `commentingRangeHint`
  (`CommentingRangeProvider.resourceHints`). All are proposed-only, so all require
  `enableProposedApi` per extension the same way `commentReveal` does.

### Decorations, reveal, selection

- `window.createTextEditorDecorationType(DecorationRenderOptions)` /
  `TextEditor.setDecorations(type, ranges | DecorationOptions[])` are fully stable. Relevant
  fields: `isWholeLine`, `gutterIconPath`/`gutterIconSize`, `overviewRulerLane`,
  `before`/`after` (`ThemableDecorationAttachmentRenderOptions.contentText` /
  `contentIconPath`), `hoverMessage` (`index.d.ts` lines 992–1258).
- Decorations are pure rendering — they never receive focus or clicks (only `hoverMessage`
  responds to mouse hover). That makes them the right tool for "highlight the current tour
  step's lines" without disturbing keyboard focus anywhere else.
- `TextEditor.revealRange(range, TextEditorRevealType)` (`Default` / `InCenter` /
  `InCenterIfOutsideViewport` / `AtTop`) and `window.showTextDocument(uri, { selection,
  preserveFocus })` are stable (`index.d.ts` lines 761–856, 1365). `preserveFocus: true` is the
  key to "jump the viewport to step N" without yanking keyboard focus away from whatever UI
  (e.g. a QuickPick or status bar) is driving the tour.

### Status bar, tree view, panel-based navigation

- `window.createStatusBarItem` → `StatusBarItem` (`id`, `alignment`, `priority`, `text`,
  `tooltip`, `command`) is stable (`index.d.ts` line 7567). Never takes focus; good home for a
  persistent "Step 3/8 ◀ ▶" control bound to two commands.
- `window.createTreeView` → `TreeView<T>` is stable, **including** `reveal(element, { select,
  focus, expand })` (`index.d.ts` line 12190–12235; requires the `TreeDataProvider` to implement
  `getParent`). Note: `microsoft/vscode`'s `vscode.proposed.treeViewReveal.d.ts` at tag `1.138.0`
  still exists in the proposed-APIs folder with the same shape, but the capability has already
  shipped to stable `@types/vscode` — the proposed file appears to be a stale/vestigial copy, not
  a sign this is still gated.
- A `TreeView` steps list is the one native piece that supports real keyboard "next/prev with
  visible focus ring" out of the box: focus the tree, arrow keys move the selection, Enter/Space
  activates.

### CodeLens, inlay hints, hover

- `CodeLens` (`range`, `command`) and `CodeLensProvider` are stable (`index.d.ts` line 2850,
  2880). Text-only, one line, click-to-run — usable as a lightweight per-step "▶ Start here" /
  "Next: parseTokens()" affordance directly in the code, but there's no keyboard-native way to
  tab between CodeLenses across a file.
- `InlayHint` / `InlayHintsProvider` are stable (`index.d.ts` line 5638, 5708). Inline greyed
  text, can carry a `command` via `InlayHintLabelPart`, but reads as an IDE annotation, not an
  interactive control — weak fit for driving a tour, fine for lightweight "step N" markers.
- `HoverProvider`/`Hover` are stable (`index.d.ts` line 3122, 3149). Only appears on mouse hover
  or the explicit `editor.action.showHover` command — a "look something up" affordance, not a
  push notification, so it can't proactively announce a new tour step.

### Peek view

- `editor.action.peekLocations` (aliased as `editor.action.showReferences`) is a plain
  `CommandsRegistry.registerCommand` in `microsoft/vscode`
  (`src/vs/editor/contrib/gotoSymbol/browser/goToCommands.ts`, tag `1.138.0`), taking
  `(uri, position, locations, multiple)` and delegating to `editor.action.goToLocations` with
  `openInPeek: true`. It is **not declared anywhere in `@types/vscode`** — it's an internal
  command extensions call by string through `vscode.commands.executeCommand`, the same one that
  backs the built-in "Peek Definition" / "Find All References" UI. It has been stable in practice
  for years but carries no versioned API contract.
- Per VS Code docs (`code.visualstudio.com/docs/editor/editingevolved`), Peek opens **inline in
  the editor** (not a new tab/panel), and focus moves into the peek widget: arrow keys navigate
  between locations, Enter or double-click jumps to a location and closes the peek, Escape closes
  it and returns focus to the editor (`editor.stablePeek` setting controls auto-close-on-click-away).
- Good building block for "here are the 3 call sites for this step," weaker fit for a single
  linear step-by-step walk, since its whole design center is "many locations from one point."

### Quick picks

- `window.createQuickPick<T>()` → `QuickPick<T>` is stable (`index.d.ts` line 13172):
  `items`, `onDidAccept`, `onDidTriggerButton`/`onDidTriggerItemButton`, `buttons`,
  `canSelectMany`. Proposed extras at `1.138.0` (not required for basic use):
  `quickPickItemTooltip`, `quickPickSortByLabel`, `valueSelectionInQuickPick`.
- QuickPick is the one native surface built explicitly for "modal-ish, keyboard-first, one item
  active at a time, Enter to accept, Escape to cancel" — arguably the most natural fit for a
  literal "tour step picker," at the cost of being an overlay that fully takes focus away from
  the code until dismissed (though it can stay open while you also update decorations/reveal the
  editor underneath, e.g. VS Code's own symbol-search-with-live-preview flow does this).

### Walkthroughs

- `contributes.walkthroughs` (`code.visualstudio.com/api/references/contribution-points`) is a
  stable contribution point rendering **native UI, no webview**: `id`/`title`/`description`/
  `steps[]`, each step has `id`/`title`/`description` (Markdown) /`media` (image or markdown
  file)/`completionEvents` (`onCommand:`, `onSettingChanged:`, `onContext:`,
  `extensionInstalled:`, `onView:`, `onLink:`) /`when`.
- It's designed for **static, package.json-declared** onboarding content shown on the
  Get Started page — not for an agent to generate a tour over a specific repo's code at runtime,
  and it doesn't have a "jump to this file/line" primitive beyond whatever command a Markdown
  link triggers. Could work as a table-of-contents shell that runs commands which then drive the
  Comments API / decorations for the actual code-pointing, but the step content itself isn't
  regenerable per-session without rewriting the extension manifest.

### Notifications

- `window.showInformationMessage` / `showWarningMessage` (+ `showErrorMessage`) are stable
  (`index.d.ts` lines 11290–11370); `MessageOptions.modal` (line 2182) controls whether it's a
  transient toast (never steals focus, auto-dismisses) or a modal dialog (fully steals focus
  until answered). Fine for "step 4 of 8 complete" pings, wrong tool for holding ongoing tour UI.

### Comments panel

- The built-in "Comments" panel is populated automatically from every `CommentController`'s
  threads — there's no separate API to opt in/out beyond creating the threads themselves. It
  gives users a persistent, clickable list of every tour step already, for free, once threads
  exist (this is already visible in the current extension via SPEC.md's "VS Code's built-in
  Comments panel lists the threads; clicking one jumps to it").

### Context keys + keybindings

- `vscode.commands.executeCommand('setContext', key, value)` plus `contributes.keybindings[].when`
  is fully stable (`code.visualstudio.com/api/references/when-clause-contexts`) and needs no
  proposed API. This is the plumbing for scoping "Alt+]/Alt+\[ = next/prev tour step" so the
  keybinding only fires while a tour is active, without stealing the keybinding globally.

## Bottom line for tour UX

No single native piece is a turnkey "linear tour" widget. The realistic native-only combination:

- **Comments API threads** (already the extension's base) as the step content — Markdown body,
  command links for "Next"/"Previous", author/label for step numbering — using the already-enabled
  `commentReveal` proposal to focus/scroll to each step.
- **Decorations** to highlight the current step's lines without moving focus.
- **A status bar item** (or a **TreeView** step list) for persistent, focus-safe "Step N of M" +
  next/prev controls, gated by **context keys** so dedicated keybindings only apply during a tour.
- **Peek view** (`editor.action.peekLocations`) as an option when a step legitimately has multiple
  related locations rather than one.
- **Quick pick** as an alternative "step chooser" front-end if a more modal, list-driven
  navigation style is preferred over inline threads.
- **Walkthroughs** likely not a fit for the live, per-repo tour itself, but usable for a one-time
  "how tours work" onboarding page shipped with the extension.
