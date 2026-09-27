# Slick Annotate — Spec

A VS Code extension for reading code closely. You leave notes on code as you read, then copy them all out in one go, usually to paste into a coding agent. Reviewing code and learning code are the same activity here.

It should feel like part of VS Code: native UI, your editor theme. The one custom-drawn surface is the tour document, because VS Code's native widgets proved too cramped to read in. The codebase stays tiny.

Terms are defined in [CONTEXT.md](./CONTEXT.md).

## Annotating

- **Annotate selection** — select some code and press Alt+A: a one-line input opens at the top of the window, focused. It stays open when you click away, so you can read the code while writing; Enter saves, Escape cancels. Or click the "+" in the margin and write in the comment box; save with Cmd+Enter. The annotation covers whole lines, and those lines are saved with it as its snippet. After saving, the thread collapses to its margin icon.
- **Add to a thread** — with nothing selected, Alt+A inside an existing annotation opens the same input, and saving adds to that thread.
- **Annotate file** — from the editor title bar or the explorer's right-click menu. The note belongs to the whole file and shows at its top.
- A question and its later answer sit together in one thread.
- Any annotation can be edited or deleted. No history is kept.
- If the code changes afterwards, nothing happens. The snippet keeps showing what you were looking at.

## The session

- There is one session. Every annotation belongs to it.
- It lives in `.slick/session.json` in the workspace. The extension adds `.slick/` to `.git/info/exclude` when it first saves a session or loads a tour, so neither shows up in git and no tracked file is touched.
- **Clear session** deletes every annotation.
- VS Code's built-in Comments panel lists the threads; clicking one jumps to it.

## Copying

**Copy session** puts plain text on the clipboard: every annotation in the order it was written, each with:

- `path/to/file.ts:40-52` for a range, or just `path/to/file.ts` for a whole file
- the snippet, in a fenced code block (range annotations only)
- the text

Nothing else is added. You write the prompt around it when you paste.

## Tours

A tour is written by a coding agent to `.slick/tour.json`: a title and an ordered list of steps. Each step has a title, a short Markdown `body`, and optionally longer `details`, a `file` and a `quote` of code from it. Mermaid diagrams work in both body and details.

- There is one tour. Writing the file replaces it, and the view reloads.
- The **Tour** view in the activity bar shows the whole tour as one document. Steps open and close independently: clicking a closed step opens it, and the chevron at the end of an open step's header collapses it. Closed steps show just their number, file and title.
- At most one step is **focused**: its code opens and its whole lines are highlighted, and it has the accent border. Clicking any step that isn't focused focuses it (opening it if closed), as do clicking the focused step's file name and Alt+] / Alt+[. Clicking in the focused step's text does nothing, so reading never pulls the editor back. Collapsing the focused step unfocuses it. Keyboard focus stays where it was. The focused step stays in place on screen, and the document only scrolls if it doesn't fit.
- A quote must appear exactly once in its file. There are no line numbers, so edits elsewhere never move a step. If the quote isn't found, or appears more than once, the file opens with nothing highlighted.
- An open step shows its body; **Show more** unfolds its details.
- Text can link to code: a Markdown link to `path/to/file` opens the file, and `path/to/file#quoted code` also selects the quote (again only if it occurs exactly once). A step's `refs` (`file`, optional `quote` and `label`) are the same links, shown as small chips under its body: other places worth seeing alongside the step's own code. Links to code never change the focused step.
- The focused step survives reloads, and which steps are open survives the view being hidden. **Unfocus step** removes the highlight. **Clear tour** deletes the tour file.
- The highlight colour is its own theme colour, `slick.tourHighlight`, so it can't be mistaken for search matches.
- Tours are separate from annotations: Copy and Clear session don't touch them.

## Commands

| Command            | Where                                   |
| ------------------ | --------------------------------------- |
| Annotate selection | Alt+A, margin "+"                       |
| Annotate file      | Editor title bar, explorer context menu |
| Copy session       | Command palette, panel title bar        |
| Clear session      | Command palette, panel title bar        |
| Next step          | Alt+], Tour view title bar              |
| Previous step      | Alt+[, Tour view title bar              |
| Go to current step | Command palette, Tour view title bar    |
| Unfocus step       | Command palette, Tour view title bar    |
| Clear tour         | Command palette, Tour view "…" menu     |

## Implementation notes

- Built on VS Code's Comments API (`vscode.comments.createCommentController`). This provides the inline comment boxes, the threads and the Comments panel.
- Whole-file annotations: the stable API (`@types/vscode` 1.138) supports threads with no range. Setting `thread.range = undefined` attaches the thread to the file. `createCommentThread` still requires a range when it is called, so create the thread first, then clear its range.
- Alt+A and Annotate File write through `vscode.window.showInputBox` (with `ignoreFocusOut`), not a thread's comment box. The thread is created only once the input is saved.
  - Before, they opened the thread's own comment box and put the cursor in its reply field with the proposed `commentReveal` API (`thread.reveal(undefined, { focus: Reply })`). That kept the note next to the code and allowed several lines, but proposed APIs can't be published to the Marketplace, and the stable API can show a thread without focusing its reply box. The input box is the trade: publishable, instant and less distracting, but one line only and at the top of the window. If `commentReveal` is finalized, or the one-line limit starts to hurt, going back is an option.
- Installed in place with **Developer: Install Extension from Location…** pointing at the repo, so a window reload picks up code changes.
- No build step: `main` points at `src/extension.ts` and VS Code's bundled Node (24.x) strips types at load. TypeScript 7 is used only to type-check (`tsc --noEmit`, with `erasableSyntaxOnly` and `.ts` import extensions). The one runtime dependency is mermaid, loaded from `node_modules` into the tour document only when a step has a diagram.
- The tour document is a webview view (`registerWebviewViewProvider`), kept alive while hidden. Step bodies are rendered by VS Code's own Markdown engine (`markdown.api.render`), which with the built-in mermaid extension turns diagram fences into `.mermaid` elements. Its stylesheet and script live in `media/` and use only theme colours.
- `.slick/session.json` is the only source of truth. Threads are rebuilt from it when the workspace opens.

## Later

- **The agent bridge** — how an agent hands over a tour (MCP or just the file). Being planned on the [wayfinder map](https://github.com/saiashirwad/slick-annotate/issues/1).
- **Agent-written Markdown** — annotate an `.md` explanation from an agent the same way. Links like `[parser](src/parse.ts#L40)` already open in VS Code, so this may cost nothing.
