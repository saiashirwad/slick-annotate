# Slick Annotate

Annotate code as you read it in VS Code, then copy every note at once, e.g. to paste into a coding agent.

## Use

| Command                   | Where                                   | Does                                                                   |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Slick: Annotate Selection | Alt+A, or the "+" in the margin         | Annotates the selected lines. Inside an annotation, adds to its thread |
| Slick: Annotate File      | Editor title bar, explorer context menu | Adds a note on the whole file                                          |
| Slick: Copy Session       | Command palette, Comments panel         | Copies every annotation as Markdown, in the order written              |
| Slick: Clear Session      | Command palette, Comments panel         | Deletes every annotation                                               |

Annotations are saved in `.slick/session.json`, which is kept out of git via `.git/info/exclude`.

## Install

1. Clone the repo.
2. In VS Code, run **Developer: Install Extension from Location…** and pick the repo folder.
3. Add this to `~/.vscode/argv.json`, then quit and reopen VS Code:

   ```json
   "enable-proposed-api": ["saiashirwad.slick-annotate"]
   ```

There's no build step: VS Code runs the TypeScript directly. `npm install && npm run check` type-checks it.
