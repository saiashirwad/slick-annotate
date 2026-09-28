# Walk format

Only these keys. Unknown keys are rejected and the previous walk stays up.

```ts
type Walk = { title: string; steps: Step[] }
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

A quote is a literal slice of the file, whitespace included, and must occur once. No line numbers, regex, or ellipses. A short unique slice is enough; the highlight is the whole lines it touches. Take it from the file you just read.

The step's own `file` and `quote` are what focusing it highlights. Other places that same step touches are `refs`, shown as links under the step. Clicking one opens that code and does not leave the step. Set `label` to a name ("where the review is copied"), not the path — without one, the link is the filename. Set `quote` too, or the click only opens the file. Several refs on one step are normal. A Markdown link does the same: `[where the review is copied](<src/submit.ts#export async function submitReview(>)`. Mermaid fences work in `body` and `details`.

A `diff` is unified (` ` context, `-` removed, `+` added). Headers are optional; a line with no sign is context. One file per diff; split a multi-file change into steps that name the dependency. The preview is built from the diff text alone, so the context has to be real lines. Viewing or approving it changes nothing.
