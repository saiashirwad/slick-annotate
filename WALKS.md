# Writing walks

- Write the walk to `.tandem/walk.json` in the workspace root. Saving the file updates the Walk view.
- Give the walk a `title` and an ordered list of `steps`.
- Each step needs a unique `id`, a `title` and a Markdown `body`. Use `details` for a longer explanation behind **Show more**.
- Add a `file` and a `quote` to highlight code. Paths are relative to the workspace root; a quote must appear exactly once in its file.
- Use `refs` for other code the same step touches. Give each a `label` that names it and a `quote`, so the link opens that spot instead of showing a path. One step can have several.
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
      "refs": [{ "label": "the destination", "file": "src/session.ts", "quote": "export class Session" }]
    }
  ]
}
```

- Replace the example paths and quotes with code from the workspace.
- A name in the prose that points at existing code is a link, not a bare code span: `[`submitReview`](<src/submit.ts#export async function submitReview(>)`. The text is the name; the quote is a unique one-line slice and need not contain the name. A name that is not in the source yet stays a code span. Escape `<` and `>` in the quote as `\<` and `\>`. A link with no quote, `[router](src/router.ts)`, only opens the file.
- Mermaid diagrams work in both `body` and `details`.

## Proposing changes

- Mark a step `"proposal": true` when it's a change you intend to make. The reader can approve it. Explain the context in ordinary steps first, so each proposal makes sense.
- Make each proposal one independently reviewable decision. It may span several files; use refs for the supporting code. Describe an architectural change's responsibilities, affected callers, and tradeoff in prose.
- Include an optional `diff` when the exact replacement matters. It previews one file; if it covers only part of the proposal, say so. File and hunk headers are optional, and unsigned lines are context. Both sides are built from the diff alone; Tandem does not apply it or check hunk counts. Use real context and actual replacement code.
- A proposed new file has no source anchor. Name its path in prose; when proposing its exact contents, use `--- /dev/null` and `+++ b/path` headers in the creation diff.
- The reader can write a response on any step, and submits the whole review when done. It's pasted to you, and it's also in `.tandem/review.json`: per step `id`, a `response` if they wrote one and an `approved` copy of the proposal if they approved it.
- An unapproved proposal has no fixed meaning: read the response. Don't make a change the reader hasn't approved.
- Approval covers the stated proposal; unspecified implementation details remain open. Wait for the user's request to implement.

The [companion skill](./skills/tandem/SKILL.md) includes a Python 3.9+ authoring validator. From this repository, run `python3 skills/tandem/scripts/validate_walk.py /path/to/workspace`. It checks anchors and diffs against current source without changing files; see its [validation contract](./skills/tandem/references/walk-format.md#validation).

## Revising

- Keep the walk's title and each step's `id` when revising, so the reader keeps their place and their review. A new title starts at step 1 with an empty review.
- Changing a proposal's `body`, `details`, `quote` or `diff` withdraws its approval, so the reader sees it again. Leave approved proposals alone unless they need to change.
- A step you remove takes its response and approval with it.
