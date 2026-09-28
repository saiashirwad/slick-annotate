# Reader input

## Review

```ts
type Review = {
  title: string
  submitted?: string
  notes: Record<string, { ok: boolean; text: string }>
}
```

Keys are step ids. Every stored note has both fields; an absent id reads as `{ ok: false, text: "" }`. Whitespace-only text becomes empty, other text is preserved. False/empty pairs are removed: there is no touched-but-empty state. Without `check`, `ok` is false, including when that option is removed. Checks survive prose rewrites; nothing snapshots or certifies exact text.

`submitted` is the last **Submit Review** time, retained through later note edits. Submission clears nothing and does not freeze a review, notify an agent, or request implementation.

Clipboard text starts `Review: <title>  (submitted <time>)`, then only steps with text or a check, in walk order. With `check`, each heading is `[x] <label> — <step title>` (or `[ ]` for text with an unchecked box); without it, only the title. Note text is indented below. Annotations follow as `# Annotations`. If a paste and the file disagree, ask which to follow.

## Annotations

`session.json` is `{ annotations: { id, threadId, file, range?, snippet, body, createdAt }[] }`. Same `threadId` shares file, range and snippet, in creation order. `range` is zero-based; no range and `snippet: ""` means the whole file.

A paste uses one-based `path:40-52` or a bare path. The fenced snippet appears only on the thread's first annotation, and is the code as it was then. Read current source before answering or editing, and say if it moved. A question wants an explanation unless a change was requested.

## If they ask how

**Alt+A** annotates the selection or the thread under the cursor. **Annotate File** covers the whole file. **Walk** is in the activity bar; **Alt+]** / **Alt+[** move between steps. Clicking a place or prose link does not change the focused step. Checks use the checkbox control; there is no toggle command or Alt+Enter binding. A collapsed step shows ✓ when checked and ✎ when it has text. **Submit Review** copies review and session. **Clear Tandem Session** deletes annotations only; **Clear Walk** deletes walk and review only.
