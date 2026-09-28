# Walk format

Only these keys are accepted. Old walk and review formats are rejected without migration; an invalid walk leaves the last good document visible.

```ts
type Walk = {
  title: string
  steps: Step[]
  check?: string
  compare?: { base: string; head?: string }
}
type Step = {
  id: string
  title: string
  body: string
  details?: string
  places: Place[]
}
type Place = { file: string; quote?: string; label?: string }
```

Ids are nonempty, unique stable names, not positions. Paths are workspace-relative (`/`), never absolute or containing `..`. Every step requires `places`, including `[]` for prose-only steps. All places appear below the body; focusing opens the first. A place's optional label replaces its displayed path.

A quote is a nonempty literal slice, whitespace included, not a line number, regex or ellipsis. Take it from source you just read; it must occur exactly once. Highlighting covers whole touched lines, excluding a final line touched only at column zero. Comparison quotes may come from either version; ambiguity in either makes the scope unavailable.

`check` is a nonempty checkbox label on every step, such as `"Approve"` or `"Keep"`. There are no per-step kinds. `compare` is independent: neither option, either alone, or both may be present. Its refs must be nonempty and locally available; see [branch walks](branch-walk.md) for endpoint and count semantics.

## Prose and links

Mermaid and ordinary code fences work in body and details. A `diff` fence is prose: neither Tandem nor its validator interprets it as a patch, opens it as a comparison, or applies it.

A name pointing at existing code is a link, not a bare code span. Use `[`submitReview`](<src/submit.ts#export async function submitReview(>)`: the text names the code and the target is a unique literal slice, not necessarily that name. Use angle brackets; escape `<` and `>` in destinations as `\<` and `\>`, and avoid raw newlines. Let the JSON encoder write the backslashes. A name that does not yet exist stays a code span.

Inline links always open current workspace files, independently of comparison or the focused step. Without a quote, `[the session](src/session.ts)` opens the file. Places can include supporting locations not already named by a sentence.

## Validation

Run the bundled standard-library-only helper with Python 3.9+:

```sh
python3 /path/to/tandem/scripts/validate_walk.py /path/to/workspace
```

Replace `/path/to/tandem` with the installed skill directory. It checks `.tandem/walk.json`; use `--walk /path/to/draft.json` to check a candidate first.

The helper checks strict structure, unique ids, every place and Markdown link. Compare anchors use read-only local Git, with shared version reads and on-demand rename discovery; inline links still use disk. Missing or ambiguous anchors are authoring diagnostics. Git failures are reported separately from structural validity and do not prevent Tandem from displaying a structurally valid walk or recording notes. Validation leaves workspace and Git state unchanged, creates no temporary copies, does not parse patches or render the view, and does not prove proposed code compiles.
