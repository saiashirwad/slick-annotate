# Reader input

## Review

```ts
type Review = {
  title: string
  submittedAt?: string
  steps: {
    id: string
    response?: string
    approved?: { body: string; details?: string; quote?: string; diff?: string }
  }[]
}
```

`approved` is that snapshot, not a boolean. It still holds only if the walk title matches, the step id exists, the step is a proposal, and those four fields are equal — absent and `""` are different. `file`, `refs`, and the step title are not in the snapshot. A response on an approved step still needs an answer. Empty entries are omitted.

`submittedAt` is the last **Submit Review**, kept across later edits. It is not a frozen review and not a handoff. Act when they ask, not because the file changed. Submit clears nothing. Approval does not mean the edit is in the tree.

A paste starts `# Review of the walk "..."`. Proposals come first (`Approved.` / `Not approved.` and any response), then responses on other steps, then `# Annotations`. If the paste and the file disagree, ask which to follow.

## Annotations

`session.json` is `{ annotations: { id, threadId, file, range?, snippet, body, createdAt }[] }`. Same `threadId` shares file, range, and snippet, in creation order. `range` is zero-based; no range and `snippet: ""` means the whole file.

A paste uses one-based `path:40-52` or a bare path. The fenced snippet is only on the thread's first note, and it is the code as it was then. Read the file before answering or editing, and say if it moved. A question wants an explanation unless they asked for a change. Don't edit their annotations.

## If they ask how

**Alt+A** annotates the selection, or the thread under the cursor if nothing is selected. **Annotate File** is the whole file. **Walk** is in the activity bar; **Alt+]** / **Alt+[** move. **Approve this change** or **Alt+Enter** toggles the focused proposal. **Submit Review** copies the review and the session. **Clear Tandem Session** deletes annotations only; **Clear Walk** deletes the walk and review only.
