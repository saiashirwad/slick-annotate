# Writing walks

- Write the walk to `.tandem/walk.json` in the workspace root. Saving the file updates the Walk view.
- Give the walk a `title` and an ordered list of `steps`.
- Each step needs a unique `id`, a `title` and a Markdown `body`. Use `details` for a longer explanation behind **Show more**.
- Add a `file` and a `quote` to highlight code. Paths are relative to the workspace root; a quote must appear exactly once in its file.
- Use `refs` to point to other code worth reading alongside the step.
- See the [JSON schema](./schemas/walk.schema.json) for the full format.

```json
{
  "title": "Move token refresh into the session",
  "steps": [
    {
      "id": "how-refresh-works",
      "title": "Where tokens are refreshed today",
      "body": "Short Markdown explanation.",
      "details": "Optional longer explanation.",
      "file": "src/auth.ts",
      "quote": "exact code from the file",
      "refs": [{ "label": "the session", "file": "src/session.ts", "quote": "export class Session" }]
    },
    {
      "id": "move-refresh",
      "proposal": true,
      "title": "Move refresh into Session",
      "body": "What you intend to change here, and why.",
      "file": "src/auth.ts",
      "quote": "function refresh(",
      "diff": "-function refresh(token) {\n+// moved to Session.refresh\n"
    }
  ]
}
```

- Replace the example paths and quotes with code from the workspace.
- Link to a file with `[router](src/router.ts)`, or select code with `[route](<src/router.ts#export function route(>)`.
- Mermaid diagrams work in both `body` and `details`.

## Proposing changes

- Mark a step `"proposal": true` when it's a change you intend to make. The reader can approve it. Explain the context in ordinary steps first, so each proposal makes sense.
- A proposal can carry an optional `diff` of the intended change, in unified diff format. File headers are optional, and `@@` lines can say where you are. Include a few lines of context. Use it where prose alone would be ambiguous.
- The reader can write a response on any step, and submits the whole review when done. It's pasted to you, and it's also in `.tandem/review.json`: per step `id`, a `response` if they wrote one and an `approved` copy of the proposal if they approved it.
- An unapproved proposal has no fixed meaning: read the response. Don't make a change the reader hasn't approved.

## Revising

- Keep the walk's title and each step's `id` when revising, so the reader keeps their place and their review. A new title starts at step 1 with an empty review.
- Changing a proposal's `body`, `details`, `quote` or `diff` withdraws its approval, so the reader sees it again. Leave approved proposals alone unless they need to change.
- A step you remove takes its response and approval with it.
