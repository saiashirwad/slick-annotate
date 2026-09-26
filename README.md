# Slick Annotate

Annotate code as you read it in VS Code, then copy every note at once, e.g. to paste into a coding agent.

## Use

- **Alt+A** annotates the selected lines. Inside an existing annotation, it adds to that thread.
- **Annotate File** (editor title bar, explorer menu) adds a note on the whole file.
- **Slick: Copy Session** copies all annotations as Markdown, in the order you wrote them.
- **Slick: Clear Session** deletes all annotations.

Annotations are saved in `.slick/session.json`, which is kept out of git via `.git/info/exclude`.

## Install

1. Clone the repo.
2. In VS Code, run **Developer: Install Extension from Location…** and pick the repo folder.
3. Add this to `~/.vscode/argv.json`, then quit and reopen VS Code:

   ```json
   "enable-proposed-api": ["saiashirwad.slick-annotate"]
   ```

There's no build step: VS Code runs the TypeScript directly. `npm install && npm run check` type-checks it.
