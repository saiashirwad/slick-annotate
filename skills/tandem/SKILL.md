---
name: tandem
description: Write or revise a Tandem walk to teach a slice of a codebase, or to guide a reader through a plan before changing code. Also use for Tandem reviews and annotations, or when someone wants to be shown how code works or walked through a change.
---

# Tandem

A walk explains a slice of code beside the source, proposes changes, or does both. The reader approves and responds in a review. Their annotations are a separate session.

Write `.tandem/walk.json` at the VS Code workspace root (first folder if multi-root), not the shell cwd. Read `review.json` and `session.json` there; missing means none. Never write those — the extension owns them. Report a file you cannot parse; do not replace it.

## Write

Read [walk format](references/walk-format.md). Follow the reader's question through the code. For an explanation, order steps as the reader needs to meet the concepts. For a proposed change, establish the context before asking for a decision. Short `body`; depth in `details`.

A step answers one question or presents one independently reviewable decision; its title states it. If the reader could accept one part and reject another, split them. One decision may touch several files: anchor it at the existing code that best demonstrates the point. A name in the prose that points at existing code is a link to that place, not a bare code span. Add a named, quoted ref only for a place the sentence does not already name.

A proposal states what changes, why, its scope, and the tradeoff. An architectural proposal can describe responsibilities and affected callers in prose. Include a `diff` when the exact replacement matters; say when it covers only part of the proposal. Keep a coordinated multi-file change together when it is one decision. For a proposed new file, name its path in prose and include a creation diff only when its exact contents are being proposed.

A change already made is an explanation, not a proposal. Stop at the walk unless the user asked for implementation.

## Answer

Read [reader input](references/reader-input.md). Answer every response and annotation, including on explanatory steps. A missing approval is not a no and not a yes. If an approval and a response disagree, ask before editing. Implement only what they asked for, against the current source; if the code has moved past the agreement, propose again instead of guessing.

Approval covers the stated proposal, including any exact edit. Unspecified implementation details remain open. Approval alone does not request implementation.

## Revise

Keep the title and each step `id` so their place and review survive. New subject, new id. Removing a step deletes its response and approval. A new title starts a new review — don't retitle for tidiness.

Leave an approved proposal's snapshotted text alone. Editing `body`, `details`, `quote`, or `diff` drops its approval. `file`, `refs`, and the step title are not in that snapshot, so a change of target still has to be said in `body` or the old approval stands.

## Deliver

Serialize the walk with a JSON encoder so quotes, backslashes, and multiline diffs survive unchanged. Run the bundled [validator](references/walk-format.md#validation) and fix its errors. Check that each proposal's scope is clear and independently reviewable, and that a name pointing at existing code is a link while a name that does not exist yet is not. Write the complete walk, then read it back.

Tell them to open **Walk** and follow the steps. For a proposal, also mention **Approve this change**, the response box, and **Submit Review**, then paste it back or let you read the file. Submitting does not notify you. If they ask how the controls work, the short list is in [reader input](references/reader-input.md#if-they-ask-how).
