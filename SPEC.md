# Tandem — Spec

A VS Code extension for reading code closely. You leave notes on code as you read, then copy them all out in one go, usually to paste into a coding agent. An agent can also write a walk through the code, which you follow step by step next to it: to explain how something works, to propose a change before making it, or both. You answer it as you go, approving proposals and responding to any step, and hand the whole review back in one go. Reviewing code and learning code are the same activity here.

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

A walk is written by a coding agent to `.tandem/walk.json`: a title and an ordered list of steps. Each step has an `id`, a title, a short Markdown `body`, and optionally longer `details`, a `file` and a `quote` of code from it. Mermaid diagrams work in both body and details. [`schemas/walk.schema.json`](./schemas/walk.schema.json) describes the file, and VS Code checks `.tandem/walk.json` against it.

- There is one walk. Writing the file replaces it, and the view reloads. If the file can't be read, the last good walk stays, with the error above it.
- A step's `id` is unique within the walk and names it across rewrites: your place, your approvals and your responses all follow the id, not the step's position or title.
- The **Walk** view in the activity bar shows the whole walk as one document, laid out like notebook cells: no boxes, just a chevron in the left gutter of each step. Steps open and close independently: clicking a closed step opens it, and an open step's chevron collapses it. Closed steps show just their number, title, file and markers.
- At most one step is **focused**: its code opens and its whole lines are highlighted, and it has a bar down its left edge, like a focused notebook cell. Clicking any step that isn't focused focuses it (opening it if closed), as do clicking the focused step's file name (a button, so it works from the keyboard too) and Alt+] / Alt+[. Clicking in the focused step's text does nothing, so reading never pulls the editor back. Collapsing the focused step unfocuses it. Keyboard focus stays where it was. The focused step stays in place on screen, and the document only scrolls if it doesn't fit.
- A quote must appear exactly once in its file. There are no line numbers, so edits elsewhere never move a step. If the quote isn't found, or appears more than once, the file opens with nothing highlighted and the status bar says which. Editing the file so the quote is found again brings the highlight back.
- An open step shows its body; **Show more** unfolds its details.
- Text can link to code: a Markdown link to `path/to/file` opens the file, and `path/to/file#quoted code` also selects the quote (again only if it occurs exactly once). A step's `refs` (`file`, optional `quote` and `label`) are the same links, shown as small chips under its body: other places worth seeing alongside the step's own code. Links to code never change the focused step.
- Which step is focused and which are open are remembered for the walk's title, by step id. An agent can rewrite its walk and you keep your place; a walk with a new title starts at step 1 with the rest closed. **Unfocus step** removes the highlight. **Clear walk** deletes the walk and its review.
- The highlight colour is its own theme colour, `tandem.walkHighlight`, so it can't be mistaken for search matches.

## Reviewing a walk

A walk can explain, propose, or mix the two: a refactor usually needs a few steps of context before its proposals make sense.

- **Proposals** — a step with `"proposal": true` is something the agent intends to change. It may carry a `diff`, shown under its body like VS Code's inline diff: tinted lines, the code in plain text, the indentation the lines share dropped, and long lines wrapped under their own start. **Open diff** shows it in VS Code's diff editor, with the step's file's syntax highlighting. Both sides are built from the diff alone, so it shows just those lines, and no file is touched. Its header says **Proposal**.
- **Approve** — a proposal has an **Approve this change** checkbox; **Toggle approval** (Alt+Enter) does the same for the focused step. An approved proposal's Proposal tag shows a check, even closed. Approval means only "yes to this as it stands"; the extension gives a missing approval no meaning, so what the agent does with it is up to your response and the agent.
- **Respond** — any step, proposal or not, has a box for your response, written inline in the document. At rest it's one line, like the Comments widget's reply box, and it grows to a few lines once focused or filled. A closed step with a response shows ✎ in its header. Typing or approving never scrolls the document.
- Your review is saved to `.tandem/review.json` as you go, so it survives reloads, and it's the agent's to read.
- **Submit review** stamps the review with the time and copies it as plain text: every proposal, approved or not, with its response; then responses on the other steps; then your annotations, as **Copy session** would give them. You hand it to the agent yourself. Submitting clears nothing: responses and approvals stay, and so does the session.
- When the agent rewrites the walk, the review follows step ids. A response stays with its step. An approval stays only if the proposal is unchanged: the extension remembers the step's `body`, `details`, `quote` and `diff` as they were when you approved, and if any differ, the proposal goes back to unapproved. A step that's gone takes its response and approval with it.
- A walk with a new title starts with an empty review.
- Walks are separate from annotations: Copy and Clear session don't touch them, and the only place the two meet is the text Submit review copies.

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
| Toggle approval      | Alt+Enter, proposal's checkbox          |
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
- The walk document is a webview view (`registerWebviewViewProvider`), kept alive while hidden. Step bodies are rendered by VS Code's own Markdown engine (`markdown.api.render`), which with the built-in mermaid extension turns diagram fences into `.mermaid` elements; if that engine is missing, the walk view says so. A proposal's `diff` is read leniently (`src/walk-diff.ts`: file headers optional, a line without a sign is context) and drawn by the extension, not the Markdown engine, so it can take the diff editor's line colours. **Open diff** passes `vscode.diff` two read-only `tandem-diff:` documents, the before and after lines, from a content provider; their path is the step's file, so the diff editor picks its language. Its stylesheet and script live in `media/` and use only theme colours; the script is type-checked with JSDoc against the message types in `src/walk-messages.ts`. `schemas/walk.schema.json` repeats the rules of the walk schema in `src/walk-data.ts` for editors, so the two change together.
- The extension owns the reader's place (focused step, open steps) and the review. The document sends one action per message (`focusStep`, `collapseStep`, `openCode`, `approve`, `respond`, `ready`) and renders the state it gets back; it never reports its own rendering as an action.
- `.tandem/review.json` holds the walk's title, when it was last submitted, and per step id: the response, and, if approved, the approved step's `body`, `details`, `quote` and `diff`. Comparing those with the rewritten step is how an approval knows it's stale; no hash, and nothing asked of the agent.
- The review is written by the walk feature, and the session by the annotations feature. Submit review's text is put together by its own module, which reads both and belongs to neither, like `lines.ts` and `git.ts`.
- "Walk" was "Tour" until reviews were added; the rename was total (files, schema, view, commands, theme colour) and `tour.json` is no longer read.
- Copy and Clear are titled "Tandem session" rather than just "Session" under the Tandem category, because the Comments panel they sit in also lists other extensions' comments.
- `.tandem/session.json` is the only source of truth. Threads are rebuilt from it when the workspace opens.

## Later

- **The agent bridge** — how an agent hands over a walk and learns a review was submitted (MCP or just the files). Being planned on the [wayfinder map](https://github.com/saiashirwad/tandem/issues/1).
- **Agent-written Markdown** — annotate an `.md` explanation from an agent the same way. Links like `[parser](src/parse.ts#L40)` already open in VS Code, so this may cost nothing.
