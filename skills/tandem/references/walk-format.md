# Walk format

Only these keys. Unknown keys are rejected and the previous walk stays up.

```ts
type Walk = { $schema?: string; title: string; steps: Step[] }
type Step = {
  id: string
  title: string
  body: string
  details?: string
  file?: string
  quote?: string
  refs?: { file: string; quote?: string; label?: string }[]
  proposal?: boolean
  diff?: string
}
```

`id` is a stable name (`persist-review`), unique, not a position. `quote` needs `file`. `diff` needs `proposal: true`. Paths are workspace-relative (`/`), never absolute or `..`.

A quote is a literal slice of the file, whitespace included, and must occur once. No line numbers, regex, or ellipses. A short unique slice is enough; the highlight is the whole lines it touches. Take it from the file you just read. The step's own `file` and `quote` are what focusing it highlights.

## Links

Clicking a link opens that code and does not leave the step.

A name in `body` or `details` that points at existing code is a link, not a bare code span. The text is the name, as code. The target is `file#quote`. The quote is a unique one-line slice, and it need not contain the name: `[`submitReview`](<src/submit.ts#export async function submitReview(>)` opens the declaration, not a search for the visible word.

Use angle brackets. A destination cannot contain a raw newline or an unescaped `<` or `>`. Escape those as `\<` and `\>`, and let the JSON encoder write the backslashes. Prefer a slice that needs no escape (`export const dispatch`, not the generic signature). A name that is not in the source yet stays a code span. Do not point it at the code it replaces.

Refs are places the sentence does not already name, shown under the step. Set `label` to a phrase ("where the review is copied"), not the path — without one, the link is the filename. Set `quote`, or the click only opens the file. Do not repeat an inline link as a ref. A link with no quote only opens the file: `[the session](src/session.ts)`. Mermaid fences work in `body` and `details`.

## Diffs

A `diff` previews one file: ` ` context, `-` removed, `+` added. File and hunk headers are optional; a line with no sign is context. Tandem renders both sides from this text alone. It neither applies the edit nor checks hunk counts against source. Include real context so the replacement is clear. A diff is the intended edit, not pseudocode.

The one-file limit belongs to the preview, not the proposal. A coordinated multi-file proposal can explain the complete change in `body`/`details` with refs. If it includes one file's diff, state which part that diff covers.

For an existing-file diff, set `file` to that file or supply `--- a/path` and `+++ b/path` headers. Headers must name the same file as `file` when both are present. For a new file, omit the step's `file` and `quote`, name the path in prose, and use `--- /dev/null` and `+++ b/path` if including a creation diff. Use refs to show the existing code that motivates it.

For a short edit, a headerless before/after snippet avoids hunk arithmetic. When providing numeric unified hunks, generate them from before/after text rather than counting lines by hand. Plain `---`/`+++` headers work; omit Git metadata such as `diff --git` and `index`, which Tandem would display as context.

## Validation

Run the bundled helper with Python 3.9+; it uses only the standard library:

```sh
python3 /path/to/tandem/scripts/validate_walk.py /path/to/workspace
```

Replace `/path/to/tandem` with the installed skill directory. The workspace argument is the VS Code workspace root. By default it checks `.tandem/walk.json`; add `--walk /path/to/draft.json` to validate a candidate before replacing the current walk.

The helper checks the schema, unique IDs, existing source anchors, Markdown links in `body` and `details`, and one-file diff previews. It checks each diff's before-text against source and verifies numeric hunk counts when supplied. A link is checked like a ref: the path must exist, and a quote must occur once. These authoring checks are stricter than the extension's display parser. It reports errors by step, ref, or link, and never changes files. It does not render the view or establish that proposed code compiles.
