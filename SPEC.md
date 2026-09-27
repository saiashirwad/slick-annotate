# Tandem — Spec

A VS Code extension for reading code closely. You leave notes on code as you read, then copy them all out in one go, usually to paste into a coding agent. An agent can also write a tour of the code, which you follow step by step next to it. Reviewing code and learning code are the same activity here.

It should feel like part of VS Code: native UI, your editor theme. The one custom-drawn surface is the tour document, because VS Code's native widgets proved too cramped to read in. The codebase stays tiny.

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
- It lives in `.tandem/session.json` in the workspace. The extension adds `.tandem/` to `.git/info/exclude` when the workspace opens, so neither the session nor a tour shows up in git and no tracked file is touched. If that fails, a warning says why.
- **Clear session** deletes every annotation.
- If `session.json` can't be read, annotations are off until it's fixed, with a warning saying why. The file is left as it is, and tours still work.
- VS Code's built-in Comments panel lists the threads; clicking one jumps to it.

## Copying

**Copy session** puts plain text on the clipboard: every annotation in the order it was written, each with:

- `path/to/file.ts:40-52` for a range, or just `path/to/file.ts` for a whole file
- the snippet, in a fenced code block (range annotations only, and only for the first annotation of each thread, since the rest share it)
- the text

Nothing else is added. You write the prompt around it when you paste.

## Tours

A tour is written by a coding agent to `.tandem/tour.json`: a title and an ordered list of steps. Each step has a title, a short Markdown `body`, and optionally longer `details`, a `file` and a `quote` of code from it. Mermaid diagrams work in both body and details. [`schemas/tour.schema.json`](./schemas/tour.schema.json) describes the file, and VS Code checks `.tandem/tour.json` against it.

- There is one tour. Writing the file replaces it, and the view reloads. If the file can't be read, the last good tour stays, with the error above it.
- The **Tour** view in the activity bar shows the whole tour as one document. Steps open and close independently: clicking a closed step opens it, and the chevron at the end of an open step's header collapses it. Closed steps show just their number, file and title.
- At most one step is **focused**: its code opens and its whole lines are highlighted, and it has the accent border. Clicking any step that isn't focused focuses it (opening it if closed), as do clicking the focused step's file name (a button, so it works from the keyboard too) and Alt+] / Alt+[. Clicking in the focused step's text does nothing, so reading never pulls the editor back. Collapsing the focused step unfocuses it. Keyboard focus stays where it was. The focused step stays in place on screen, and the document only scrolls if it doesn't fit.
- A quote must appear exactly once in its file. There are no line numbers, so edits elsewhere never move a step. If the quote isn't found, or appears more than once, the file opens with nothing highlighted and the status bar says which. Editing the file so the quote is found again brings the highlight back.
- An open step shows its body; **Show more** unfolds its details.
- Text can link to code: a Markdown link to `path/to/file` opens the file, and `path/to/file#quoted code` also selects the quote (again only if it occurs exactly once). A step's `refs` (`file`, optional `quote` and `label`) are the same links, shown as small chips under its body: other places worth seeing alongside the step's own code. Links to code never change the focused step.
- Which step is focused and which are open are remembered for the tour's title. An agent can rewrite its tour and you keep your place; a tour with a new title starts at step 1 with the rest closed. **Unfocus step** removes the highlight. **Clear tour** deletes the tour file.
- The highlight colour is its own theme colour, `tandem.tourHighlight`, so it can't be mistaken for search matches.
- Tours are separate from annotations: Copy and Clear session don't touch them.

## Commands

| Command              | Where                                   |
| -------------------- | --------------------------------------- |
| Annotate selection   | Alt+A, margin "+"                       |
| Annotate file        | Editor title bar, explorer context menu |
| Copy Tandem session  | Command palette, panel title bar        |
| Clear Tandem session | Command palette, panel title bar        |
| Next step            | Alt+], Tour view title bar              |
| Previous step        | Alt+[, Tour view title bar              |
| Go to current step   | Command palette, Tour view title bar    |
| Unfocus step         | Command palette, Tour view title bar    |
| Clear tour           | Command palette, Tour view "…" menu     |

## Implementation notes

- Built on VS Code's Comments API (`vscode.comments.createCommentController`). This provides the inline comment boxes, the threads and the Comments panel.
- Whole-file annotations: the stable API (`@types/vscode` 1.138) supports threads with no range. Setting `thread.range = undefined` attaches the thread to the file. `createCommentThread` still requires a range when it is called, so create the thread first, then clear its range.
- Alt+A and Annotate File write through `vscode.window.showInputBox` (with `ignoreFocusOut`), not a thread's comment box. The thread is created only once the input is saved.
  - Before, they opened the thread's own comment box and put the cursor in its reply field with the proposed `commentReveal` API (`thread.reveal(undefined, { focus: Reply })`). That kept the note next to the code and allowed several lines, but proposed APIs can't be published to the Marketplace, and the stable API can show a thread without focusing its reply box. The input box is the trade: publishable, instant and less distracting, but one line only and at the top of the window. If `commentReveal` is finalized, or the one-line limit starts to hurt, going back is an option.
- Installed in place with **Developer: Install Extension from Location…** pointing at the repo, so a window reload picks up code changes.
- No build step: `main` points at `src/extension.ts` and VS Code's bundled Node (24.x) strips types at load. TypeScript 7 is used only to type-check (`tsc --noEmit`, with `erasableSyntaxOnly` and `.ts` import extensions). The runtime dependencies are valibot, which checks `session.json`, `tour.json`, saved tour progress and the tour document's messages before they are used, and mermaid, loaded from `node_modules` into the tour document only when it contains a diagram.
- The tour document is a webview view (`registerWebviewViewProvider`), kept alive while hidden. Step bodies are rendered by VS Code's own Markdown engine (`markdown.api.render`), which with the built-in mermaid extension turns diagram fences into `.mermaid` elements; if that engine is missing, the tour view says so. Its stylesheet and script live in `media/` and use only theme colours; the script is type-checked with JSDoc against the message types in `src/tour-messages.ts`. `schemas/tour.schema.json` repeats the rules of the tour schema in `src/tour-data.ts` for editors, so the two change together.
- The extension owns the reader's place (focused step, open steps). The document sends one action per message (`focusStep`, `collapseStep`, `openCode`, `ready`) and renders the state it gets back; it never reports its own rendering as an action.
- Copy and Clear are titled "Tandem session" rather than just "Session" under the Tandem category, because the Comments panel they sit in also lists other extensions' comments.
- `.tandem/session.json` is the only source of truth. Threads are rebuilt from it when the workspace opens.

## Later

- **The agent bridge** — how an agent hands over a tour (MCP or just the file). Being planned on the [wayfinder map](https://github.com/saiashirwad/tandem/issues/1).
- **Agent-written Markdown** — annotate an `.md` explanation from an agent the same way. Links like `[parser](src/parse.ts#L40)` already open in VS Code, so this may cost nothing.
