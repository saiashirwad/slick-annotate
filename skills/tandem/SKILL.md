---
name: tandem
description: Write or revise a Tandem walk to teach a slice of a codebase, or to guide a reader through a plan before changing code. Also use for Tandem reviews and annotations, or when someone wants to be shown how code works or walked through a change.
---

# Tandem

A walk explains a slice of code beside the source, proposes changes, or does both. The reader approves and responds in a review. Their annotations are a separate session.

Write `.tandem/walk.json` at the VS Code workspace root (first folder if multi-root), not the shell cwd. Read `review.json` and `session.json` there; missing means none. Never write those — the extension owns them. Report a file you cannot parse; do not replace it.

## Write

Read [walk format](references/walk-format.md). Same file either way. To teach a slice, order the steps as the reader has to meet that code, and don't propose anything. To guide them through a plan you already have, explain that context in ordinary steps first, then the proposals. Follow the question from the entry point that makes the rest make sense — not a list of files. One claim per step; the title states it. Short `body`; depth in `details`.

A step highlights one place. When that claim touches other code, keep it one step and add a ref for each other place: a name for what it is, and a quote so the click lands on those lines. A ref with no name shows the path. Don't split one claim into a step per file.

A proposal says what will change, why, and the tradeoff, with a `diff` when the edit should be exact. A change already made is an explanation, not a proposal. A new file has no anchor: name the path in prose and put the creation in `diff`. Stop at the walk unless they asked you to implement.

## Answer

Read [reader input](references/reader-input.md). Answer every response and annotation, including on explanatory steps. A missing approval is not a no and not a yes. If an approval and a response disagree, ask before editing. Implement only what they asked for, against the current source; if the code has moved past the agreement, propose again instead of guessing.

## Revise

Keep the title and each step `id` so their place and review survive. New subject, new id. Removing a step deletes its response and approval. A new title starts a new review — don't retitle for tidiness.

Leave an approved proposal's snapshotted text alone. Editing `body`, `details`, `quote`, or `diff` drops its approval. `file`, `refs`, and the step title are not in that snapshot, so a change of target still has to be said in `body` or the old approval stands.

## Deliver

Check the format, unique ids, and that every quoted file is in the workspace and each quote occurs once. A diff is the edit you mean, not a sketch. Write the whole file, then read it back.

Tell them to open **Walk** and follow the steps. For a proposal, also mention **Approve this change**, the response box, and **Submit Review**, then paste it back or let you read the file. Submitting does not notify you. If they ask how the controls work, the short list is in [reader input](references/reader-input.md#if-they-ask-how).
