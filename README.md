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

## Tours

A coding agent can walk you through code by writing `.slick/tour.json`:

```json
{
  "title": "From request to response",
  "steps": [
    {
      "title": "Where a request comes in",
      "body": "Markdown, including mermaid diagrams.",
      "file": "src/server.ts",
      "quote": "exact code from the file"
    }
  ]
}
```

The **Tour** view in the activity bar shows the whole tour as one document, with only the current step open. Clicking a step or pressing Alt+] / Alt+[ highlights its code. A step's `quote` must appear exactly once in its `file`; otherwise the file opens with nothing highlighted.

| Command                   | Where                                |
| ------------------------- | ------------------------------------ |
| Slick: Next Step          | Alt+], Tour view title bar           |
| Slick: Previous Step      | Alt+[, Tour view title bar           |
| Slick: Go to Current Step | Command palette, Tour view title bar |
| Slick: End Tour           | Command palette, Tour view title bar |

## Install

1. Clone the repo.
2. In VS Code, run **Developer: Install Extension from Location…** and pick the repo folder.
3. Add this to `~/.vscode/argv.json`, then quit and reopen VS Code:

   ```json
   "enable-proposed-api": ["saiashirwad.slick-annotate"]
   ```

It isn't on the Marketplace because it uses a proposed VS Code API, which published extensions can't.
