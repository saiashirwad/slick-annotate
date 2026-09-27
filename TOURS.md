# Writing tours

- Write the tour to `.tandem/tour.json` in the workspace root. Saving the file updates the Tour view.
- Give the tour a `title` and an ordered list of `steps`.
- Each step needs a `title` and a Markdown `body`. Use `details` for a longer explanation behind **Show more**.
- Add a `file` and a `quote` to highlight code. Paths are relative to the workspace root; a quote must appear exactly once in its file.
- Use `refs` to point to other code worth reading alongside the step.
- See the [JSON schema](./schemas/tour.schema.json) for the full format.

```json
{
  "title": "From request to response",
  "steps": [
    {
      "title": "Where a request comes in",
      "body": "Short Markdown explanation.",
      "details": "Optional longer explanation.",
      "file": "src/server.ts",
      "quote": "exact code from the file",
      "refs": [{ "label": "the router", "file": "src/router.ts", "quote": "export function route(" }]
    }
  ]
}
```

- Replace the example paths and quotes with code from the workspace.
- Link to a file with `[router](src/router.ts)`, or select code with `[route](<src/router.ts#export function route(>)`.
- Mermaid diagrams work in both `body` and `details`.
- Keep the tour's title when revising it to preserve the reader's place. A new title starts at step 1.
