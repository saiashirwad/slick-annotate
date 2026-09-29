# A Neovim-native Tandem: feasibility and implementation plan

Research date: 2026-09-29. Scope: source inspection of this checkout and official, release-tagged Neovim documentation; no plugin implementation or interactive runtime testing. Local references below use repository-relative `file:line` locations. No private session data was read.

## Recommendation

**Build a sibling, pure-Lua Neovim client, starting with annotations, sharing Tandem's files and agent conventions rather than a TypeScript/RPC backend.** Annotation feature parity is achievable with ordinary buffers, windows, extmarks, commands, and registers. The main work is recreating the interaction that VS Code's Comments API currently supplies, plus reliable persistence—not inventing an annotation engine.

Walk/review **behavioral** parity is also feasible, but its notebook-like webview is a separate UI rewrite. A native Markdown split with folds, code navigation, responses, approval commands, and read-only diff windows is sensible; browser-quality Markdown/Mermaid rendering is not a baseline terminal feature. Do not make diagram rendering a prerequisite for annotations.

For a developer already comfortable with Neovim Lua, budget approximately **3–5 working days for a useful annotation prototype, 2–4 weeks total for dependable annotation parity, and another 4–7 weeks for dependable native walk/review parity**. These are planning estimates, not measured development results. Clipboard/remote/platform testing and concurrency policy can expand them.

## 1. What annotations actually do today

### Behavior, not just the README

| Area            | Observed implementation                                                                                                                                                                                                                                                                          | Neovim consequence                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation/root | Uses only `workspaceFolders[0]`; annotations load independently of walks. Only `file:` URIs whose owning workspace folder equals that first folder are accepted (`src/extension.ts:8–23`, `src/annotations.ts:13–41`).                                                                           | Select an explicit project root and reject non-file/out-of-root buffers. Neovim has no equivalent workspace-folder selection built into this feature. |
| Capture         | Selection expands to whole lines. An end at column zero on a later line excludes that later line; the range ends at the last included line's end, not at the next line (`src/lines.ts:3–7`). Snippet comes from the open document, including unsaved edits (`src/annotations.ts:84–90,168–185`). | Capture once, before opening the annotation editor. Do not reread the on-disk file at save time.                                                      |
| Grouping        | Saved annotations group by `threadId`; first appearance determines thread creation order, and array order determines annotations within a thread (`src/annotations.ts:60–67`).                                                                                                                   | Keep array order; do not sort by timestamps or file location.                                                                                         |
| Adding          | With no selection, the first existing thread covering the cursor line is reused. A nonempty selection always creates a new thread, even if it overlaps an existing one. File annotation reuses the first whole-file thread (`src/annotations.ts:93–117,168–185,213–230`).                        | Support overlapping threads and disambiguation; do not treat `(file, range)` as thread identity.                                                      |
| Input/view      | Command input is one line; native comment input can supply longer text. Saves collapse the thread and disable its reply box. Author is always “You” (`src/annotations.ts:137–164,188–211,303–315`; `SPEC.md:82–85`).                                                                             | Multiline scratch-buffer input is an improvement consistent with the stored contract.                                                                 |
| Edit/delete     | Edit changes only `body`; blank/whitespace-only saves are ignored. Cancel restores preview. Delete removes one annotation; the last deletion disposes the thread. No edit history or updated timestamp (`src/annotations.ts:267–299`).                                                           | Preserve IDs, creation time, anchor and snippet on edits.                                                                                             |
| Clear           | Confirmation then writes `{ annotations: [] }`, disposes threads, and increments a generation counter. An input opened before clear/deletion cannot resurrect the stale thread (`src/annotations.ts:137–163,249–265`).                                                                           | Capture generation/thread identity in the input transaction.                                                                                          |
| Changed source  | No annotation document-change handler or persisted relocation exists. Original anchor/snippet remain; a warning covers changes while initial input was open (`src/annotations.ts:84–90,137–163`; contrast walk changes at `src/walk.ts:378–380`).                                                | Extmark movement must not silently rewrite the stored snapshot.                                                                                       |
| Copy            | Global annotation creation order, heading per annotation, snippet only at first occurrence of each range thread, extension as fence language, a fence longer than any contained backtick run; headings show one-based inclusive lines (`src/copy.ts:4–34`).                                      | Port exact text formatting and test interleaved threads.                                                                                              |
| Errors          | Bad load disables annotation activation until fix/reload. Save precedes in-memory/UI update; errors warn and retain the previous in-memory state (`src/annotations.ts:13–21,69–82`).                                                                                                             | Fail closed without replacing malformed files; preserve input text when saving fails.                                                                 |

**“Does it track edited code?”** Not as a persistent annotation model. No code rebases ranges or refreshes snippets. The VS Code host may affect a live comment's displayed range; that host behavior was not experimentally tested. `threadAt` consults the live thread range, while saving a reply uses the original anchor. Do not mistake this for a persistent tracking guarantee. Walks, in contrast, deliberately relocate by unique exact quote (`src/walk.ts:395–408`).

### Exact session contract

Illustrative data, not workspace contents:

```json
{
  "annotations": [
    {
      "threadId": "thread-example",
      "file": "src/example.ts",
      "range": {
        "start": { "line": 4, "character": 0 },
        "end": { "line": 5, "character": 12 }
      },
      "snippet": "first line\nsecond line!",
      "id": "annotation-example",
      "body": "Why does this happen?\nWhat about the empty case?",
      "createdAt": "2026-09-29T12:00:00.000Z"
    }
  ]
}
```

The authoritative definitions are `src/session.ts:7–40,58–77` and `src/validation.ts:3–13`:

- `annotations` is an array; empty is valid. Each annotation contains all shown fields except optional `range`.
- Positions are **zero-based nonnegative safe integers**. End must not precede start. These are VS Code position characters (UTF-16 code units), not Neovim byte columns. The schema does not verify that the range exists in the current file or corresponds to the snippet.
- `id` and `threadId` must be nonempty strings, not necessarily UUIDs. The UI generates random UUIDs. Annotation IDs must be unique globally within the session; thread IDs intentionally repeat.
- Every member of a thread must have deeply equal `{ threadId, file, range, snippet }`.
- Whole-file annotation: **omit `range`**, with `snippet: ""`. Do not encode absent fields as `null`.
- `body` is any string at validation time, including empty/whitespace, although interactive creation/edit rejects whitespace-only text. `snippet` is any string for a range annotation.
- `createdAt` must be a string accepted by JavaScript `Date.parse`; it is not restricted by validation to the canonical ISO form that the UI writes. A Lua port needs compatible legacy timestamp handling or a documented narrower import boundary; do not claim an ISO-only validator is identical.
- `file` is a nonempty string rejecting leading `/` or `\`, drive-letter prefixes, any `..` path segment separated by either slash, and NUL. It does **not** canonicalize separators, verify existence, reject `.` segments, or resolve symlinks.
- Session objects use Valibot `object`, unlike strict walk/review objects. Unknown keys are not part of the output schema and should not be relied on for extensions. Preserve valid old data by testing against the existing parser, rather than inserting Neovim-only metadata into these objects.

The normal UI captures whole lines, but the validator permits partial-column ranges. Import/display must tolerate them. Snippets are immutable snapshots, not match strings used to relocate annotation threads.

### Storage and concurrent writers: the important gap

`load` returns an empty session only when the file is absent. `save` creates `.tandem/` and directly overwrites pretty JSON plus a trailing newline (`src/session.ts:50–88`). It does not revalidate on save, lock, compare a revision, create a temporary file, rename atomically, or retain a backup. A failed write leaves memory unchanged, **but does not guarantee the disk file is intact** after truncation/partial write.

Annotations load once. There is no watcher or merge on external session changes. Two VS Code windows, or VS Code plus Neovim, can overwrite each other's annotations using stale memory. Copy session uses memory; submit review freshly loads session from disk (`src/annotations.ts:236–246`; `src/submit.ts:6–25`). A shared JSON format is **not concurrent-writer coordination**.

Git exclusion is attempted once at activation using `git rev-parse --git-path info/exclude`, not by assuming `.git` is a directory. It appends `.tandem/` if absent, preserves existing contents, ignores a non-repository error, and warns on other failures (`src/git.ts:5–25`, `src/extension.ts:13–17`). Follow that worktree-aware lookup. Git is optional for annotation functionality; ignoring files does not untrack files already committed.

## 2. What to share versus rewrite

| Layer                      | Source                                                                        | Portability                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Annotation UI/lifecycle    | `src/annotations.ts` (324 lines), `src/extension.ts` (25)                     | Rewrite in Lua: controller, threads, input, commands, workspace and clipboard integration are VS Code APIs.                            |
| Session validation/storage | `src/session.ts` (88), `src/validation.ts` (13)                               | Share contract and fixtures; reimplement Node filesystem and Valibot validation in Lua.                                                |
| Formatting                 | `src/copy.ts` (34)                                                            | Small portable algorithm; TypeScript and Node `extname` are not directly executable in Lua.                                            |
| Whole-line normalization   | `src/lines.ts` (8)                                                            | Portable semantics, editor-dependent implementation.                                                                                   |
| Git/errors                 | `src/git.ts` (26), `src/errors.ts`                                            | Port process/filesystem plumbing; no need for a service.                                                                               |
| Walk model/review/diff     | `src/walk-data.ts`, `src/review.ts`, `src/walk-diff.ts`                       | Mostly portable rules; rewrite syntax and validation, use shared fixtures.                                                             |
| Walk controller            | `src/walk.ts` (415)                                                           | Mixes useful state rules with VS Code watching, documents, state storage and webview. Extract semantics, not the controller wholesale. |
| Rendering                  | `src/walk-page.ts`, `src/walk-messages.ts`, `media/walk.js`, `media/walk.css` | HTML, DOM, CSS, Markdown renderer and message transport are not native Neovim UI; replace.                                             |
| Agent-facing assets        | `schemas/walk.schema.json`, `skills/tandem/`                                  | Share almost unchanged. Adapt workspace-root and reader-control instructions; keep ownership and review meaning.                       |

Counts above describe source size, not port cost. The deceptively short annotation controller benefits from a complete host-provided thread UI. A Lua implementation must own that UI itself. Shared conformance fixtures offer more value than running a Node sidecar for fewer than a few hundred lines of data logic. A backend later makes sense if both clients need an actual coordinated agent service, authenticated transport, or transactional storage—not simply because both read JSON.

## 3. Official Neovim building blocks and version floor

**Recommend Neovim 0.10.0+ as the initial supported floor**, with tests on the oldest supported release and current stable. This is a verified API-availability baseline, not a claim to have tested the plugin or to recommend an old patch release. The tagged 0.10 docs include all facilities below; 0.10's release notes explicitly introduce `vim.fs.root`, `vim.system`, and bundled OSC 52 clipboard support [N1–N3]. Supporting older versions is possible with adapters, but unnecessary initially.

API version notes below are deliberately distinguished from the version requirement of particular options: an API existing since an older release does not mean every modern extmark/window option existed then.

| Need                    | Native implementation and version evidence                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands/ranges         | `nvim_create_user_command` with `range = true`; callback has `line1`, `line2`, `range`. Lua command/autocmd APIs are present in 0.7.0 [N4]. `:'<,'>TandemAnnotate` naturally takes visual line ranges. A visual mapping can capture mode/endpoints before leaving Visual mode [N5].                                                                                                |
| Capture/indexing        | `nvim_buf_get_lines` uses zero-based, end-exclusive indices; cursor/mark APIs use one-based rows and zero-based columns. API columns are byte offsets, not display cells. See `api-indexing`, `nvim_buf_get_mark`, `nvim_win_get_cursor` [N1]. Convert at explicit boundaries.                                                                                                     |
| Markers/highlights      | `nvim_create_namespace` and `nvim_buf_set_extmark`: range highlight, virtual text, gravity, and in 0.10 `sign_text`/`sign_hl_group`. Basic extmark API is present in 0.5.0 [N6]; use 0.10 documentation for the actual options [N1]. Separate namespaces from diagnostics and walk focus.                                                                                          |
| Multiline editor/viewer | `nvim_create_buf(false, true)` plus `nvim_open_win` floating window; both are present in 0.4.0 [N7]. Buffer-local mappings, `filetype=markdown`, ordinary editing, wrap, explicit save/cancel. A normal split is a built-in small-screen/accessibility fallback.                                                                                                                   |
| Simple prompt           | `vim.ui.input` exists in 0.6.0 [N8]. It is an overrideable callback interface, but its built-in prompt is not a multiline document editor. Use it only for quick one-line input, not as the sole path [N2].                                                                                                                                                                        |
| Session list            | `vim.fn.setloclist` or `setqflist`, then native list navigation; use one-based `lnum`/`end_lnum` and thread ID in item metadata. Prefer a dedicated split for richly grouped threads; a location list is less intrusive than replacing the user's global quickfix list [N9].                                                                                                       |
| Clipboard               | `vim.fn.setreg('+', text, 'v')` through the configured clipboard provider. Also offer a named/unnamed register and scratch export fallback. Providers depend on host tools; bundled OSC 52 can reach a supporting local terminal over SSH, but terminal/tmux policy matters and clipboard reads may be unavailable [N3,N9]. Do not require or silently replace `g:clipboard`.      |
| JSON/files/processes    | `vim.json.decode/encode`, `vim.uv` filesystem functions, `vim.fs.root`, `vim.system` are documented in 0.10 [N2]. `pcall` decoding; validate types after decoding. Carefully distinguish empty arrays, empty objects, absent keys and `vim.NIL`. No Node/Bun runtime.                                                                                                              |
| Refresh/watch           | `nvim_create_autocmd` for `BufReadPost`, `BufEnter`, `TextChanged`, `TextChangedI`, `FocusGained`; `vim.uv.new_fs_event` for external writers, with scheduled callbacks. Official docs provide a watch-file example and prohibit most API calls directly in uv callbacks [N2,N4,N10]. Watch the directory for atomic replacement; supplement notifications with read-before-write. |
| Proposed diffs          | Build two scratch buffers from before/after text and enable `:diffthis`; do not apply patches to real files. Native diff windows are documented in 0.10 [N11].                                                                                                                                                                                                                     |
| Walk document           | Ordinary Markdown buffer with syntax highlighting, manual/expression folds, mappings and extmarks; fold mechanisms documented in [N12]. Explicitly persist step IDs/open state rather than relying on transient folds alone.                                                                                                                                                       |

There is **no direct Neovim equivalent to VS Code's Comments controller** supplying inline editable threads and a Comments panel. The official primitives above compose an equivalent workflow, not the same widget. Neovim's terminal UI is a screen-grid UI, not a DOM/webview or bundled Mermaid renderer [N13]. Keep fenced diagrams readable as text initially. Optional external rendering, browser preview, or terminal image integrations can be added later; this is a dependency/terminal-capability tradeoff, not a claim that diagrams are impossible.

### Suggested interaction

Names and mappings here are examples, not fixed bindings:

1. Visual selection → `:TandemAnnotate` (optional `<Plug>` mapping): capture whole lines and immutable snippet, open a scratch float in Insert mode. Normal-mode command reuses a thread covering the cursor, otherwise annotates its line.
2. Save via buffer-local explicit action such as `<C-s>` or `:TandemSave`; cancel via `:TandemCancel`. Escape should retain normal Vim editing semantics, not unexpectedly discard text. Failed save leaves the draft open.
3. Render a small sign/short virtual-text marker; show count if threads overlap. Avoid always displaying full annotations over source.
4. `:TandemThread` opens a read-only Markdown thread view with its original snippet and ordered annotations. Actions select an annotation for edit/delete or append. A chooser resolves overlap, while a strict-compatibility normal annotate action can retain first-created selection.
5. `:TandemList` opens grouped threads in a dedicated split (or location list); Enter visits source; an explicit action opens the thread. Missing files remain listable/editable/exportable.
6. `:TandemCopy` copies exact Tandem Markdown to the chosen register/clipboard and reports the destination honestly. `:TandemAnnotateFile` creates a file-level thread and marks it distinctly at the top. `:TandemClear` confirms clearing the session only.

No Telescope, Nui, Treesitter, Markdown-rendering plugin, Node host, or LuaRocks package is necessary. Offer extension hooks later; the default must work in stock Neovim.

## 4. Engineering decisions that matter before coding

### Range/snapshot policy

- Store current protocol coordinates, **not one-based Neovim command lines**. Convert UTF-8 byte offsets to UTF-16 code units when writing character positions; convert back when displaying imported partial ranges. For whole-line end columns, count UTF-16 units in the last line, not Lua `#line`, Unicode code points, or terminal cells. Test emoji, combining marks, tabs and non-ASCII paths.
- Normalize characterwise, linewise and reversed selections intentionally. Neovim Visual endpoints are normally inclusive and depend on `'selection'`; VS Code's selection end is exclusive. Do not mechanically apply the VS Code “column zero excludes final line” rule to an inclusive Neovim selection. Ex line ranges already identify included lines. For blockwise selections recommend explicitly expanding all touched lines, rather than storing a rectangular snippet that the protocol cannot express.
- Join snapshot lines using the buffer's line-ending convention (not blindly assuming LF when interoperating with CRLF snapshots); omit the terminator after the last included line to match `wholeLines`. Do not normalize an imported snippet.
- **Initial recommendation: persisted ranges stay fixed**, and indicators are recreated from them after edits. Mark visibly stale/unavailable locations; never clamp and save altered locations silently. Extmarks move with edits by default; that is a rendering convenience, not permission to rebase JSON. A later optional live anchor may move only in memory, clearly separate from original location/snippet. Neither approach guarantees that the old location still refers to the same code.

### Root/path policy

Choose root once per session: explicit setup/command override first, nearest existing `.tandem` or Git project marker as a documented default, then explicit confirmation/configuration for non-Git projects. Do not allow changing `:lcd` or buffer cwd to silently move the session. Maintain per-root state if multiple projects are open.

Reject unnamed, terminal, help, scratch and URI-backed non-file buffers. Validate lexical relative paths as today, then check canonical containment to prevent symlink escapes; preserve a normalized relative spelling in the protocol. This stricter containment is a deliberate security improvement, not existing parity. Decide whether in-root symlinks share thread identity with their targets. A deleted file need not invalidate the entire session: retain its annotations and show an unavailable-target notice. Git worktrees each need their own selected root, with Git's own exclude path resolution.

### Safe writes and interoperability

For a dependable client:

1. Decode and validate before enabling mutation. Keep malformed data untouched and expose a reload/retry command; do not silently reset it.
2. Retain the original file content/fingerprint. Before a mutation, reread and detect external changes; invalidate stale input transactions or present reload/conflict choices rather than blindly overwrite.
3. Write complete JSON to a uniquely created temporary file in the same directory; check write/close errors, then rename over the destination. Consider fsync/directory sync for stronger crash durability and clean up only the temporary file owned by this operation. Test replacement behavior on target platforms.
4. Only publish the new session/markers after successful persistence. Keep the draft on errors. Encode empty arrays correctly; do not serialize Lua objects as `null` or turn `annotations: []` into `{}`.
5. Directory watcher + focus/reload checks refresh external changes; debounce agent walk rewrites and retain the last good walk on parse failure.

**Read-before-write alone still has a race.** Atomic rename avoids torn documents, not lost updates. A cooperating lock/revision scheme could serialize two new clients, but the current VS Code client does not honor it. Initial release should explicitly support one writer per root, detect likely conflicts, and never promise VS Code/Neovim simultaneous writing is safe. Robust multi-client writing requires a protocol/storage change in both clients (or a coordinating service). Do not auto-merge deletions/clear with appends casually.

## 5. Later walk/review parity and shared protocols

### Formats to retain

`walk.json` is a strict object `{ $schema?: string, title: string, steps: Step[] }`. Each strict step has `{ id, title, body, details?, file?, quote?, refs?, proposal?, diff? }`; refs have `{ file, quote?, label? }`. IDs and quotes are nonempty, step IDs unique, quote requires file, diff requires `proposal: true`, and paths use the same lexical restriction (`src/walk-data.ts:4–30`). A diff does not require `file` at validation time. Empty walk steps are valid.

`review.json` is a strict object `{ title, submittedAt?, steps: [{ id, response?, approved?: { body, details?, quote?, diff? } }] }`. `approved` is a snapshot object, **not a boolean**. `submittedAt` uses the same parseable timestamp check. The review parser does not itself reject duplicate step IDs (`src/review.ts:7–40`); normal mutation removes duplicates for the edited ID (`src/review.ts:84–98`).

Compatibility behaviors worth fixtures:

- New walk title resets review; same title keeps responses for surviving IDs. Approval survives only for a remaining proposal whose body/details/quote/diff are exactly equal, including missing versus empty strings (`src/review.ts:53–81`). File, refs and step title are **not** compared. That is a known semantic limitation, not something the Lua client should silently “fix” alone.
- Reader progress `{ title, step, focused, opened }` is currently VS Code workspace state, **not one of the shared JSON files** (`src/walk-data.ts:32–67`, `src/walk.ts:30–31,153–159`). Store Neovim-only progress separately in its state directory keyed by canonical root; do not invent fields in strict walk/review files.
- Quote matching counts all exact occurrences, including overlapping matches; only one occurrence produces a whole-line highlight. Changes to the open file re-evaluate the highlight (`src/walk.ts:98–150,378–408`). Port plain-string matching, not Lua pattern matching.
- Watch walk create/change/delete; parse errors keep the last good walk. Deletion/recreation preserves progress/review until a new walk is known (`src/walk.ts:254–274,301–320,343–355`).
- Proposal diff display is intentionally lenient: strips leading file headers, ignores backslash marker lines, accepts unprefixed context and omits hunk headers from synthesized before/after buffers (`src/walk-diff.ts:1–32`). No source mutation when viewing or approving.
- Submit first saves the timestamp, formats every proposal in walk order (including unapproved), then responses on non-proposals, then current disk annotations. Clipboard failure does not undo the already saved submission timestamp; malformed session omits annotations with warning (`src/review.ts:100–119`, `src/walk.ts:247–252`, `src/submit.ts:8–25`).
- Clear walk and review is separate from clear session. Current removal is sequential, not a multi-file transaction (`src/walk.ts:276–299`).

### Native walk UI scope

Use a nonmodifiable Markdown split representing steps with deterministic line-to-step mapping, folds for body/details, proposal/approval/response markers, next/previous/focus/unfocus commands, refs/code-link actions, and a multiline response editor. Preserve the user's reading position when typing/approving, and do not force code navigation on every cursor movement. Read-only diff splits supply the substantive “Open diff” behavior. The current DOM and response textarea handling (`src/walk-page.ts:16–34`, `media/walk.js:34–117`) must be redesigned, not translated line-for-line.

The largest parity gap is presentation: Mermaid, HTML Markdown layout, clickable controls and inline textareas. Stock Markdown syntax/folds plus explicit actions can preserve information and review semantics. Optional diagram rendering should be isolated and user-initiated, with text fallback and no automatic execution of agent-supplied content.

### Schema/version/agent gaps

There is **no explicit schema version or migration dispatcher** in session, walk or review. `$schema` is optional walk metadata, not a version negotiation mechanism. Walk and review reject unknown keys; session accepts a non-strict shape. The prior tour-to-walk change stopped reading `tour.json` (`SPEC.md:94`). Do not add a `version` field unilaterally: old strict clients will reject it. Define shared protocol documentation, golden JSON/Markdown fixtures and coordinated migrations before incompatible changes. Add session/review JSON Schemas if useful, keeping runtime checks authoritative.

Reuse `skills/tandem/` and its standard-library Python authoring validator. The skill already separates annotations from review, prohibits agents from writing reader-owned files, preserves IDs, and explains that submission is not an automatic notification (`skills/tandem/SKILL.md:8–38`, `skills/tandem/references/reader-input.md:17–33`). Change its VS Code-specific root/control instructions to client-neutral language with Neovim examples. The validator is an optional agent-authoring tool, not a Python dependency for the Neovim plugin. Approval still does not authorize implementation by itself.

## 6. Phases, module layout and acceptance criteria

Suggested sibling layout (illustrative, not files created by this research):

```text
plugin/tandem.lua                 command registration only
lua/tandem/init.lua              setup and per-root lifecycle
lua/tandem/project.lua           root and path containment, Git exclusion
lua/tandem/protocol.lua          session/walk/review validation
lua/tandem/store.lua             load, atomic write, change/conflict detection
lua/tandem/session.lua           thread/order/edit/delete/clear operations
lua/tandem/range.lua             selection and byte/UTF-16 conversion
lua/tandem/format.lua            exact copy/submit text
lua/tandem/ui/{input,thread,list,markers}.lua
lua/tandem/walk.lua              later walk state and quote location
lua/tandem/review.lua            later approvals/responses/reconciliation
lua/tandem/ui/{walk,diff}.lua     later native reader/diff display
 doc/tandem.txt                  help and example mappings
 tests/fixtures/                 shared protocol and formatting cases
```

| Phase                         | Estimated effort                              | Completion criteria                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Useful prototype              | 3–5 days                                      | Explicit root; create selection/line/file annotations; immutable snippet; save/reload existing format; thread marker/view; native multiline input; list/jump; copy to a register. Can demonstrate the complete read → annotate → hand-to-agent loop.                                                |
| Dependable annotation parity  | Additional 7–15 days; roughly 2–4 weeks total | Append/edit/delete/clear, overlap UI, stale draft guards, malformed input isolation, atomic writes/error recovery, external-change detection, exact formatter fixtures, Unicode/CRLF tests, Git worktrees, clipboard fallback, help and minimum-version testing. Explicit single-writer limitation. |
| Walk/review behavioral parity | Additional 20–35 days; roughly 4–7 weeks      | Strict validation; watch/last-good state; stable IDs and progress; unique quote navigation; refs; native folds/Markdown; read-only diffs; responses/approval invalidation; submit/clear boundaries; agent skill documentation and cross-client fixtures.                                            |
| Optional presentation polish  | Separate scope                                | Markdown enhancement/diagram integrations, sophisticated inline thread layout, mouse controls and terminal-specific tuning. No firm estimate before selecting integrations and terminals.                                                                                                           |

These ranges assume one developer familiar with Lua/Neovim, ordinary review and tests, no bespoke terminal-image renderer, and no cross-client locking retrofit. Scheduling includes implementation, not only porting data functions; interruptions and unfamiliar-platform work are extra.

Release acceptance checklist:

- Golden fixtures load in both clients; Lua-created JSON round-trips through existing validators; export text agrees byte-for-byte for multiline bodies, interleaved threads and embedded fences.
- Creation timestamps/order remain unchanged on edit. Removing the first annotation still causes the remaining thread's first annotation to print its snippet. Clear session never touches walk/review.
- Character/line/block/reversed selections, inclusive/exclusive endpoints, empty lines, EOF without newline, CRLF, emoji, tabs and imported partial ranges have defined tests.
- Unsaved-buffer snippet remains unchanged after edits, undo, rename, reload or missing file. Fixed stored positions are never silently changed by extmark gravity.
- Reject non-file/out-of-root/traversal paths and test symlink policy. Distinct worktrees and directory changes cannot unexpectedly redirect writes.
- Malformed JSON, inconsistent anchors, duplicate IDs, bad timestamps, out-of-range integers, unknown strict fields, permission failure, failed rename and partial temporary write do not destroy the last good session or the draft.
- Two-editor scenario reproduces current lost-update risk, and the new client's conflict path warns rather than implying safe coordination. Watcher reload cannot overwrite a dirty draft unnoticed.
- Stock Neovim without plugins supports every primary action. No clipboard provider still yields a usable named register/export buffer. Test local and SSH/tmux setups rather than infer remote clipboard success.
- Later: changed proposal loses approval; file-only changes retain it under the current protocol; duplicate/missing quotes do not highlight arbitrary code; proposal viewing never edits project files.

## 7. Remaining decisions and unverified items

1. Confirm initial root selection and symlink identity policy; Neovim has no VS Code workspace root to inherit.
2. Confirm fixed markers versus transient live-moving markers. Preserve snapshots either way; persistent relocation would be a new shared feature.
3. Choose dedicated list split versus location list as default and explicit save/cancel keys; prototype this with real terminal dimensions.
4. Decide whether single-writer detection is enough initially or both clients must be upgraded for coordinated writers. No unilateral Lua lock can protect against the existing VS Code writer.
5. Decide the compatibility policy for permissive JavaScript timestamps and odd-but-valid paths; introduce conformance fixtures before narrowing validation.
6. Browser-style walk presentation, exact terminal clipboard behavior, live VS Code comment-range movement, filesystem watcher reliability and atomic replacement on every target OS were **not experimentally verified**. The research verifies available APIs and current code paths, not end-to-end runtime behavior.

## Official Neovim sources

Release-tagged sources avoid accidentally requiring features added after the proposed minimum. User-manual links provide convenient help navigation; use the pinned source when versions differ.

- **N1 — API, 0.10.0:** [tagged api.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/api.txt), [API indexing](https://neovim.io/doc/user/api.html#api-indexing), [extmarks](<https://neovim.io/doc/user/api.html#nvim_buf_set_extmark()>). Covers buffer/mark/window indices, extmark options, scratch buffers and floats.
- **N2 — Lua, 0.10.0:** [tagged lua.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/lua.txt), [vim.fs.root](<https://neovim.io/doc/user/lua.html#vim.fs.root()>), [vim.json](https://neovim.io/doc/user/lua.html#vim.json), [vim.uv](https://neovim.io/doc/user/lua.html#vim.uv). Covers filesystem, JSON, process calls, UI input and watch-file callback scheduling.
- **N3 — Clipboard and 0.10 additions:** [provider.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/provider.txt), [0.10 release notes](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/news.txt), [clipboard providers](https://neovim.io/doc/user/provider.html#provider-clipboard). OSC 52 needs compatible terminal/configuration; no general remote clipboard guarantee.
- **N4 — Commands/autocmds available in 0.7:** [0.7 API manual](https://github.com/neovim/neovim/blob/v0.7.0/runtime/doc/api.txt), [user commands](<https://neovim.io/doc/user/api.html#nvim_create_user_command()>), [autocmd API](<https://neovim.io/doc/user/api.html#nvim_create_autocmd()>).
- **N5 — Visual selection:** [0.10 visual.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/visual.txt), [Visual mode](https://neovim.io/doc/user/visual.html#Visual-mode). Characterwise, linewise, blockwise and selection semantics.
- **N6 — Extmarks available in 0.5:** [0.5 API manual](https://github.com/neovim/neovim/blob/v0.5.0/runtime/doc/api.txt). For newer decoration options, use N1 rather than assume 0.5 parity.
- **N7 — Floats/scratch buffer API available in 0.4:** [0.4 API manual](https://github.com/neovim/neovim/blob/v0.4.0/runtime/doc/api.txt). For current window options, use N1.
- **N8 — UI input available in 0.6:** [0.6 Lua manual](https://github.com/neovim/neovim/blob/v0.6.0/runtime/doc/lua.txt).
- **N9 — Lists/registers:** [0.10 builtin.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/builtin.txt), [setloclist](<https://neovim.io/doc/user/builtin.html#setloclist()>), [setreg](<https://neovim.io/doc/user/builtin.html#setreg()>).
- **N10 — Filesystem events:** [0.10 Lua watch example](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/lua.txt), [autocmd events](https://neovim.io/doc/user/autocmd.html#autocommand-events). Treat watchers as invalidation hints, not write coordination.
- **N11 — Native diff:** [0.10 diff.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/diff.txt), [:diffthis](https://neovim.io/doc/user/diff.html#%3Adiffthis).
- **N12 — Folds:** [0.10 fold.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/fold.txt), [fold methods](https://neovim.io/doc/user/fold.html#fold-methods).
- **N13 — UI model:** [0.10 ui.txt](https://github.com/neovim/neovim/blob/v0.10.0/runtime/doc/ui.txt), [UI protocol](https://neovim.io/doc/user/api-ui-events.html). Native grid rendering is distinct from an embedded browser surface.
