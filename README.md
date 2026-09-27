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

## Throwaway Tour prototype (#6)

Copy `examples/tour.json` to `.slick/tour.json` in this workspace to try the seven-step example.

Open the **Tour** activity-bar view and click a step. Use **Alt+]** / **Alt+[**, **Slick: Go to Current Step**, or **Slick: End Tour** (also in the view toolbar). The current index survives window reloads; End Tour stays ended until you click a step. Saving the tour JSON refreshes the list and current thread without stealing focus. Only the first workspace folder is used.

Tours use `{ "title": "…", "steps": [{ "title": "…", "body": "Markdown", "file": "relative/path", "quote": "exact code" }] }`. `file` and `quote` are optional. A unique exact quote gets a whole-line highlight; missing or ambiguous quotes get a file-level thread without a highlight. Text-only steps open a read-only native text document. No Tour text is saved into or copied with your annotations.

This branch is for trying the interaction, not the agent bridge or a settled persistence format.

## Install

1. Clone the repo.
2. In VS Code, run **Developer: Install Extension from Location…** and pick the repo folder.
3. Add this to `~/.vscode/argv.json`, then quit and reopen VS Code:

   ```json
   "enable-proposed-api": ["saiashirwad.slick-annotate"]
   ```

It isn't on the Marketplace because it uses a proposed VS Code API, which published extensions can't.
