# Tandem

A VS Code extension for reading code alongside a coding agent. It provides two separate tools:

- **[Annotations](#annotations)**: your notes on code, copied out as Markdown for an agent.
- **[Tours](#tours)**: an agent's walk through code, one step at a time, with each step's code highlighted.

## Annotations

Notes you write on lines or whole files as you read.

- **Alt+A**: annotate the selected lines, or add to the annotation you're in.
- **Annotate File**: editor title bar, or right-click in the explorer.
- **Copy / Clear**: Comments panel title bar.
- Saved in `.tandem/session.json`, kept out of git.
- Only files in the (first) workspace folder.
- Stop the Comments panel opening on reload: `"comments.openView": "never"`.

## Tours

A walk through the code that an agent writes for you.

- The agent writes `.tandem/tour.json` ([schema](./schemas/tour.schema.json)):

  ```json
  {
    "title": "From request to response",
    "steps": [
      {
        "title": "Where a request comes in",
        "body": "Short Markdown explanation.",
        "details": "Optional longer one, behind Show more.",
        "file": "src/server.ts",
        "quote": "exact code from the file",
        "refs": [{ "label": "the router", "file": "src/router.ts", "quote": "export function route(" }]
      }
    ]
  }
  ```

- **Tour** view in the activity bar: click a step to highlight its code.
- **Alt+] / Alt+[**: next / previous step.
- A `quote` must appear exactly once in its file.
- `[route](<src/router.ts#export function route(>)` links to code.
- Mermaid diagrams work.

## Install

1. Clone, then `npm install`.
2. **Developer: Install Extension from Location…** → pick the folder.
