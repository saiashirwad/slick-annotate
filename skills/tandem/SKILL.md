---
name: tandem
description: Write or revise a Tandem walk to teach a slice of a codebase, or guide a reader through a plan before changing code. Also use for Tandem reviews and annotations, or when someone wants to be shown how code works or walked through a change.
---

# Tandem

A walk is prose plus places in code. The reader leaves notes; their annotations are a separate session.

Use `.tandem/` at the VS Code workspace root (first folder if multi-root). Read `review.json` and `session.json` there; missing means none. Never write reader-owned files. Report a file you cannot parse instead of replacing it.

## Write

Read [walk format](references/walk-format.md). For a branch walk, also read [branch walks](references/branch-walk.md). Follow the reader's question through the code, introducing context before decisions. Keep `body` short and depth in `details`.

Each step answers one question or presents one independently reviewable decision; its title states it. Split decisions that could be accepted independently. One decision may span files, and one file may appear in several steps. Choose ordered places deliberately; no script generates the narrative.

A proposed change states what changes, why, its scope, and its tradeoff. Describe responsibilities and affected callers in prose; use an ordinary Markdown `diff` fence when exact replacement text matters, stating any limits of its scope. Proposed new paths stay in prose until they exist. Stop at the walk unless implementation was requested.

## Answer and revise

Read [reader input](references/reader-input.md). Answer every note and annotation. Interpret checks using the walk's label and the reader's text; an unchecked box alone is neither a rejection nor permission to edit. Act on the user's request, against current source, rather than on submission or a check alone. If their instructions conflict, ask before editing.

Keep the title and step ids when revising the same subject. New subject, new id; a new title starts an empty review. Notes follow surviving ids even when prose changes; removed steps lose their notes. Walks are disposable: write a new one when the explanation no longer serves the reader, rather than relying on staleness tracking.

## Deliver

Serialize with a JSON encoder, run the bundled validator, fix its diagnostics, and read back the complete walk. Check the narrative's decision boundaries yourself; validation cannot judge them.

Tell the reader to open **Walk**, leave notes and any labeled checks, then **Submit Review** and paste it back or ask you to read the saved file. Submission does not notify an agent.
