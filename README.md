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
      "body": "A short explanation, in Markdown.",
      "details": "Optional: the longer one, shown on \"Show more\". Mermaid diagrams work in both.",
      "file": "src/server.ts",
      "quote": "exact code from the file",
      "refs": [{ "label": "the router", "file": "src/router.ts", "quote": "export function route(" }]
    }
  ]
}
```

The **Tour** view in the activity bar shows the whole tour as one document. Open and close steps by clicking their headers; any number can be open. One step at a time is focused, with its code highlighted: opening a step, clicking an open step's file name, or Alt+] / Alt+[ focuses it, and closing it unfocuses it. A step's `quote` must appear exactly once in its `file`; otherwise the file opens with nothing highlighted. Links in the text open code too: `[the router](src/router.ts)` opens a file, and `[route](<src/router.ts#export function route(>)` also selects that quoted code. `refs` are the same links, shown under the step's text. The highlight colour is `slick.tourHighlight`, which you can change in `workbench.colorCustomizations`.

| Command                   | Where                                |
| ------------------------- | ------------------------------------ |
| Slick: Next Step          | Alt+], Tour view title bar           |
| Slick: Previous Step      | Alt+[, Tour view title bar           |
| Slick: Go to Current Step | Command palette, Tour view title bar |
| Slick: Unfocus Step       | Command palette, Tour view title bar |
| Slick: Clear Tour         | Command palette, Tour view "…" menu  |

## Install

1. Clone the repo and run `npm install` (tour diagrams need mermaid).
2. In VS Code, run **Developer: Install Extension from Location…** and pick the repo folder.
3. Add this to `~/.vscode/argv.json`, then quit and reopen VS Code:

   ```json
   "enable-proposed-api": ["saiashirwad.slick-annotate"]
   ```

It isn't on the Marketplace because it uses a proposed VS Code API, which published extensions can't.
