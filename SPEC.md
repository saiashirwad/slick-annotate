# Slick Annotate — Spec

A VS Code extension for reading code closely. You leave notes on code as you read, then copy them all out in one go, usually to paste into a coding agent. Reviewing code and learning code are the same activity here.

It should feel like part of VS Code: native UI only, your editor theme, nothing custom-drawn. The codebase stays tiny.

Terms are defined in [CONTEXT.md](./CONTEXT.md).

## Annotating

- **Annotate selection** — select some code, press the shortcut, type in VS Code's comment box, save with Cmd+Enter. The selected code is saved with the annotation as its snippet.
- **Annotate file** — from the editor title bar or the explorer's right-click menu. The note belongs to the whole file and shows at its top.
- Annotating the same place again adds to that place's thread, so a question and its later answer sit together.
- Any annotation can be edited or deleted. No history is kept.
- If the code changes afterwards, nothing happens. The snippet keeps showing what you were looking at.

## The session

- There is one session. Every annotation belongs to it.
- It lives in `.slick/session.json` in the workspace. The extension adds `.slick/` to `.git/info/exclude`, so it never shows up in git and no tracked file is touched.
- **Clear session** deletes every annotation.
- A native side panel lists threads, and clicking one jumps to it.

## Copying

**Copy session** puts plain text on the clipboard: every annotation in the order it was written, each with:

- `path/to/file.ts:40-52` for a range, or just `path/to/file.ts` for a whole file
- the snippet, in a fenced code block (range annotations only)
- the time it was written
- the text

Nothing else is added. You write the prompt around it when you paste.

## Commands

| Command            | Where                                   |
| ------------------ | --------------------------------------- |
| Annotate selection | Keyboard shortcut, editor context menu  |
| Annotate file      | Editor title bar, explorer context menu |
| Copy session       | Command palette, panel title bar        |
| Clear session      | Command palette, panel title bar        |

## Implementation notes

- Built on VS Code's Comments API (`vscode.comments.createCommentController`). This provides the inline comment boxes, the threads and the Comments panel.
- Whole-file annotations: the stable API (`@types/vscode` 1.138) supports threads with no range. Setting `thread.range = undefined` attaches the thread to the file. `createCommentThread` still requires a range when it is called, so create the thread first, then clear its range.
- No build step: `main` points at `src/extension.ts` and VS Code's bundled Node (24.x) strips types at load. TypeScript 7 is used only to type-check (`tsc --noEmit`, with `erasableSyntaxOnly` and `.ts` import extensions). No runtime dependencies.
- `.slick/session.json` is the only source of truth. Threads are rebuilt from it when the workspace opens.

## Later

- **Guided tours** — the agent walks you through code. Needs careful UX design first.
- **Agent-written Markdown** — annotate an `.md` explanation from an agent the same way. Links like `[parser](src/parse.ts#L40)` already open in VS Code, so this may cost nothing.
