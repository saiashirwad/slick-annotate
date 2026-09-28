# Tandem — Spec

A VS Code extension for reading code closely. You leave annotations on code as you read, then copy them out, usually to paste into a coding agent. An agent can also write a walk to explain code, propose a change, or both. You leave notes on its steps and hand the review back in one go. Reviewing code and learning code are the same activity here.

It should feel like part of VS Code: native UI, your editor theme. The one custom-drawn surface is the walk document, because VS Code's native widgets proved too cramped to read in. The codebase stays tiny.

Terms are defined in [CONTEXT.md](./CONTEXT.md).

## Annotating

- **Annotate selection** — select some code and press Alt+A: a one-line input opens at the top of the window, focused. It stays open when you click away, so you can read the code while writing; Enter saves, Escape cancels. Or click the "+" in the margin and write in the comment box; save with Cmd+Enter. The annotation covers whole lines, and those lines are saved with it as its snippet. After saving, the thread collapses to its margin icon. Expanded, it shows just its notes under a header naming its lines (or file); there's no reply box.
- **Add to a thread** — with nothing selected, Alt+A inside an existing annotation opens the same input, and saving adds to that thread.
- **Annotate file** — from the editor title bar or the explorer's right-click menu. The note belongs to the whole file and shows at its top.
- A question and its later answer sit together in one thread.
- Any annotation can be edited or deleted. No history is kept.
- If the code changes afterwards, nothing happens. The snippet keeps showing what you were looking at.
- Only files inside the workspace folder can be annotated (in a multi-root workspace, the first folder). Elsewhere the margin "+" doesn't appear, and Alt+A and Annotate file say why in the status bar.

## The session

- There is one session. Every annotation belongs to it.
- It lives in `.tandem/session.json` in the workspace. The extension adds `.tandem/` to `.git/info/exclude` when the workspace opens, so neither the session nor a walk shows up in git and no tracked file is touched. If that fails, a warning says why.
- **Clear session** deletes every annotation.
- If `session.json` can't be read, annotations are off until it's fixed, with a warning saying why. The file is left as it is, and walks still work.
- VS Code's built-in Comments panel lists the threads; clicking one jumps to it.

## Copying

**Copy session** puts plain text on the clipboard: every annotation in the order it was written, each with:

- `path/to/file.ts:40-52` for a range, or just `path/to/file.ts` for a whole file
- the snippet, in a fenced code block (range annotations only, and only for the first annotation of each thread, since the rest share it)
- the text

Nothing else is added. You write the prompt around it when you paste.

## Walks

A walk is written by a coding agent to `.tandem/walk.json`: a title and ordered steps, with independent optional `check` and `compare` traits. Each step has a unique nonempty `id`, a title, a short Markdown `body`, optional longer `details`, and a required ordered `places` array. Each place has a workspace-relative `file`, optional nonempty literal `quote`, and optional `label`. Empty place lists are valid. Mermaid diagrams and ordinary code fences work in body and details. [`schemas/walk.schema.json`](./schemas/walk.schema.json) and runtime parsing accept only this contract; removed fields and old review files are rejected without migration.

- There is one walk. Writing the file replaces it, and the view reloads. If the file can't be read, the last good walk stays, with the error above it.
- A step's `id` names it across rewrites: progress and notes follow the id, not its position or title.
- The **Walk** view is one notebook-like document. Steps open and close independently; a chevron collapses an open step. Closed steps show number, title, ✓ when checked and ✎ when they have text.
- At most one step is **focused**, marked with a bar down its left edge. Focus opens the first prepared place and highlights whole quote lines; empty-place steps focus without an editor jump. Clicking an unfocused step or Alt+] / Alt+[ focuses it. Clicking focused prose does nothing. Collapsing the focused step unfocuses it. Editor opens preserve keyboard focus; the document preserves the focused step's screen position and scrolls only as needed.
- Places are resolved once per accepted walk load, sharing file contents and literal quote matches. A plain quote must occur exactly once. Missing or ambiguous quotes leave navigation available without a highlight, with a visible reason. Ranges refresh when the walk reloads, not as a side effect of editing source or navigating.
- An open step shows its body; **Show more** unfolds its details.
- All places appear below the body as labeled buttons, with the path as default label. Clicking a place uses its prepared target without changing the focused step. Inline Markdown links retain workspace-only semantics: `path/to/file` opens disk, and `path/to/file#quoted code` selects a uniquely matching quote. Linked code spans stay chips. Links, diff buttons, note inputs and checks do not also focus a step.
- Which step is focused and which are open are remembered for the walk's title, by step id. An agent can rewrite its walk and you keep your place; a walk with a new title starts at step 1 with the rest closed. **Unfocus step** removes the highlight. **Clear walk** deletes the walk and its review.
- The highlight colour is its own theme colour, `tandem.walkHighlight`, so it can't be mistaken for search matches.

## Reviewing a walk

- Every step has a **note** box, compact until focused or filled. Optional walk-wide `check` is a nonempty string adding one checkbox with exactly that label to every step. Use the checkbox control; there is no toggle command or Alt+Enter binding. Checks have no universal approval or rejection meaning.
- `.tandem/review.json` is `{ title, submitted?, notes: { [stepId]: { ok, text } } }`. Every note has both fields; absent ids read as false/empty. Whitespace-only text becomes empty; other text is preserved. False/empty entries are removed, so there is no touched-but-empty state. Without `check`, `ok` is false, including after removing the trait.
- Notes save before being published to the page. An unreadable review is left alone and disables review writes until fixed or cleared. Typing and checking do not scroll or rebuild prose; arriving comparison data preserves active input.
- **Submit review** saves `submitted` and copies `Review: <title>  (submitted <time>)`, then only steps with text or a check, in walk order. With `check`, a heading is `[x] <label> — <step title>` (or `[ ]` for an unchecked note); otherwise just the title. Note text is indented below. Annotations follow as **Copy session** would format them. Submission clears nothing and does not notify an agent or request implementation.
- Notes survive rewrites under the same title and ids, even when prose or targets change. Removed ids lose their notes; a new title starts empty. Walks are disposable: nothing tracks staleness or snapshots approved prose.
- Walks and annotations remain independent. Copy/Clear session do not touch walks; Submit review is their only meeting point.

## Comparing actual code

- Optional `compare: { base, head? }` requires nonempty local refs. Resolve base and head to commits, then use their unique merge-base on the left. With head omitted, HEAD determines the merge-base and the right side is the real working tree, including uncommitted tracked edits and untracked files. With explicit head, both sides are immutable committed documents. Navigation prefers head (disk when omitted), falling back to base for deleted files.
- Check and compare compose independently: omit both for an explanation; use `check: "Approve"` alone for labeled notes; use `compare: { base: "main", head: "feature" }` alone for a branch walk; add `check: "Keep"` to combine them. Proposed edits are ordinary Markdown `diff` fences, not runtime patch fields or inline previews.
- Comparison starts asynchronously after accepting structure and Markdown, with a pending state. Resolve endpoints once and run one batched zero-context Git diff per load. Include rename sources outside the selected places, then retain requested files. Repeated files and quotes share preparation-local content and match results. Navigation, typing, source saves, ref changes and diff opening never prepare another comparison.
- Unquoted +/− counts cover the file. For a quote, select exactly the union of hunks whose nonempty old or new line range intersects its unique whole-line range on that version; count each hunk once. Zero-length sides intersect nothing. Old-only quotes are valid; unique quotes on both sides use both ranges. No intersection is +0/−0. Ambiguity in either side or absence in both makes scope unavailable, never a whole-file or nearest-hunk fallback.
- Each place's **Open diff** opens full native file endpoints with quote-based reveal, including unrelated changes. Valid endpoints remain openable even if scoped counts are unavailable. Counts/ranges reflect the last walk load; VS Code owns the live working-tree document and can show later changes. Save the walk again to refresh preparation.
- Renames use the new path and compare old against new; additions/deletions compare against an empty absent side. Binary files, symlinks and submodules are unavailable. Git, ref, merge-base or file failures show a reason, never invented zero counts, and do not block prose, notes or independent checks. Multiple merge-bases are unavailable.
- Comparison is read-only: no fetch, checkout, merge, staging or commit. A branch ref must already exist locally. The existing workspace setup that excludes `.tandem/` from Git remains separate.

## Commands

| Command              | Where                                   |
| -------------------- | --------------------------------------- |
| Annotate selection   | Alt+A, margin "+"                       |
| Annotate file        | Editor title bar, explorer context menu |
| Copy Tandem session  | Command palette, panel title bar        |
| Clear Tandem session | Command palette, panel title bar        |
| Next step            | Alt+], Walk view title bar              |
| Previous step        | Alt+[, Walk view title bar              |
| Go to current step   | Command palette, Walk view title bar    |
| Unfocus step         | Command palette, Walk view title bar    |
| Submit review        | Command palette, Walk view title bar    |
| Clear walk           | Command palette, Walk view "…" menu     |

## Implementation notes

- Built on VS Code's Comments API (`vscode.comments.createCommentController`). This provides the inline comment boxes, the threads and the Comments panel.
- Whole-file annotations: the stable API (`@types/vscode` 1.138) supports threads with no range. Setting `thread.range = undefined` attaches the thread to the file. `createCommentThread` still requires a range when it is called, so create the thread first, then clear its range.
- Alt+A and Annotate File write through `vscode.window.showInputBox` (with `ignoreFocusOut`), not a thread's comment box. The thread is created only once the input is saved.
  - Before, they opened the thread's own comment box and put the cursor in its reply field with the proposed `commentReveal` API (`thread.reveal(undefined, { focus: Reply })`). That kept the note next to the code and allowed several lines, but proposed APIs can't be published to the Marketplace, and the stable API can show a thread without focusing its reply box. The input box is the trade: publishable, instant and less distracting, but one line only and at the top of the window. If `commentReveal` is finalized, or the one-line limit starts to hurt, going back is an option.
- Installed in place with **Developer: Install Extension from Location…** pointing at the repo. Run `bun run build` or keep `bun run watch` running, then reload the window to pick up changes. F5 builds before launching an Extension Development Host.
- Packaged with `bun run package`, which runs type, lint, and formatting checks and the Bun build before producing a VSIX in `dist/`. An explicit `.vscodeignore` allowlist keeps workspace data and development tools out. The extension bundle and source map, webview assets, schema, docs, Mermaid's standalone browser bundle, and dependency licenses and notices are shipped. `tools/package-assets.ts` copies Mermaid and installed dependency notices into `dist/`; `vsce --no-dependencies` packages the self-contained output. Bun manages dependencies through `bun.lock`; CI installs with `--frozen-lockfile` and produces the same VSIX.
- Requires VS Code 1.138 or later and a trusted workspace backed by a filesystem. Virtual workspaces and browser extension hosts are unsupported. The extension runs in the workspace extension host so filesystem operations happen alongside the project, including in remote sessions.
- Bun 1.4.0 bundles `src/extension.ts` into the ESM entry point `dist/extension.js` with a linked source map, targeting Node and leaving `vscode` external. VS Code's bundled Node runs it; Bun is needed only for development and packaging. TypeScript 7 separately type-checks the source (`tsc --noEmit`, with `erasableSyntaxOnly` and `.ts` import extensions). Valibot is bundled and tree-shaken; it checks `session.json`, `walk.json`, `review.json`, saved walk progress and the walk document's messages before they are used. Mermaid's prebuilt browser bundle is loaded from `dist/mermaid.min.js` into the walk document only when it contains a diagram.
- The walk document is a retained webview view. VS Code's Markdown engine (`markdown.api.render`) renders body/details, including diff fences and Mermaid. Missing Markdown support produces a visible error. Theme-colored assets live in `media/`; JSDoc checks the script against `src/walk-messages.ts`. The editor JSON schema mirrors runtime validation.
- `walk-check.ts` owns checkbox updates; `walk-compare.ts` owns batched comparison and hunk analysis; `walk-places.ts` resolves targets for the host using the shared literal locator. The host composes these concrete paths without a registry. Load guards discard results for replaced walks.
- `tandem-diff:` documents identify repository, resolved revision and path, preserving extensions for language selection. The provider reuses prepared content or reads that immutable revision on demand. Absent sides are empty read-only documents; a present working-tree side is the actual workspace URI. There are no mutable snippets or provider invalidation events.
- The host owns progress and notes. The document sends validated `focusStep`, `collapseStep`, `openCode`, `openPlace`, `openDiff`, `setCheck`, `setText` or `ready` actions. Place actions carry step id and index; the dispatcher checks document identity and bounds. Published state includes saved notes and prepared comparison results, with no Git work on publication.
- The review is written by the walk feature, and the session by the annotations feature. Submit review's text is put together by its own module, which reads both and belongs to neither, like `lines.ts` and `git.ts`.
- "Walk" was "Tour" until reviews were added; the rename was total (files, schema, view, commands, theme colour) and `tour.json` is no longer read.
- Copy and Clear are titled "Tandem session" rather than just "Session" under the Tandem category, because the Comments panel they sit in also lists other extensions' comments.
- `.tandem/session.json` is the only source of truth. Threads are rebuilt from it when the workspace opens.

## Agent skill

The companion [skill](./skills/tandem/SKILL.md) covers authoring, note/annotation interpretation, revision and controls. Its conditional branch reference teaches decisions and places, not generated narratives. Install the entire folder separately, including references and scripts; the extension does not install it.

The standard-library-only Python 3.9+ validator checks strict structure, places and Markdown links. Compare anchors can exist on either version, with local read-only Git endpoint resolution, batched rename discovery and shared content reads. Git failures are distinct from structural errors and never become a runtime acceptance gate. Diff fences are prose and are not validated patches. `WALKS.md` redirects to the maintained contract; historical old-format examples/captures are retired.

## Later

- **The agent bridge** — how an agent hands over a walk and learns a review was submitted (MCP or just the files). Being planned on the [wayfinder map](https://github.com/saiashirwad/tandem/issues/1).
- **Agent-written Markdown** — annotate an `.md` explanation from an agent the same way. Links like `[parser](src/parse.ts#L40)` already open in VS Code, so this may cost nothing.
