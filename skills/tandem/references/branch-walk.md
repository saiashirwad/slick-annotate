# Branch walks

Compare against a ref that exists locally. “Land” here means the branch ref has been fetched into the repository, not checked out or merged. Acquisition is preparation outside Tandem: comparison never fetches, checks out, merges, stages or commits.

Inspect the actual comparison before writing one step per decision. Use the new path for renames, several places for a decision spanning files, and quotes to divide one file between decisions.

```json
{ "compare": { "base": "main", "head": "feature" } }
```

This option compares the merge-base of `main` and `feature` on the left with the resolved `feature` commit on the right. Both documents are read-only. Ordinary place navigation opens head, falling back to base only when the file is deleted at head.

Omit `head` to find the merge-base of base and HEAD, then compare it against the real working tree, including uncommitted tracked edits and untracked files. Navigation and the diff's right side use disk. Counts describe saved disk content at walk load, not unsaved editor buffers. A supplied head never depends on which branch is checked out.

Preparation compares temporary copies of loaded endpoint content, including missing base paths for rename discovery; unreadable files are excluded individually. Unstaged renames and files removed only from the index therefore use their real endpoints. The copies are removed afterward; no workspace or index is changed.

Without a quote, +/− counts cover the file. With a quote, take the union of zero-context hunks whose nonempty old or new line ranges intersect the quote's unique whole-line range on that side. Count each selected hunk once. Zero-length sides intersect nothing; no intersection means +0/−0, never the nearest hunk. Old-only quotes are valid. An ambiguous quote on either side or no match on both makes scoped counts unavailable, while usable full-file endpoints can still open.

**Open diff** always shows full native file comparisons, with quote-based reveal; unrelated changes remain visible. Counts and place ranges are prepared once per walk load, not on navigation, notes, saves, ref updates or opening a diff. Reload the walk to refresh them; the native working-tree side can change meanwhile.

Renames compare old and new paths; additions/deletions use an empty absent side. Binary files, symlinks and submodules are unavailable. A file-specific failure affects only that comparison, preserving readable head navigation and other places. Missing Git, refs, a unique merge-base, or any other clean answer produces a visible unavailable reason without blocking prose or notes. Do not invent zero counts for failures or totals across overlapping places.

Add `check: "Keep"` if the reader needs a labeled check on each step. It is optional and independent of comparison.
