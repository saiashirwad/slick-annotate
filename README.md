# Tandem

Tandem lets you annotate code in VS Code and follow walks through it written by a coding agent. Collect questions as you read, review proposed changes beside the code, and copy your annotations and review back to the agent.

## Installation

Install [Tandem from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=saiashirwad.tandem), or run:

```sh
code --install-extension saiashirwad.tandem
```

Requires VS Code 1.138 or later and a trusted workspace folder on disk. In a multi-root workspace, Tandem uses the first folder. Virtual workspaces and vscode.dev are not supported.

## Annotations

Select some code and press **Alt+A**. Type your annotation and press Enter to save it. Annotations appear as native comment threads beside the code and in VS Code's **Comments** panel.

![An annotation attached to the code that copies a thread's snippet](./docs/images/annotations.png)

- To add to an existing thread, place the cursor inside its range with nothing selected and press **Alt+A**.
- To annotate a whole file, use **Annotate File** in the editor title bar or the explorer context menu.
- To edit or delete an annotation, use the buttons on the annotation.

Run **Copy Tandem Session** to copy all your annotations, with file paths and code snippets, ready to paste into an agent. Snippets keep the code as it was when you annotated it, even if the file changes later.

**Clear Tandem Session** deletes all annotations. Both commands are available in the Comments panel title bar and the command palette.

## Walks

A walk is a sequence of steps an agent writes to explain code, propose changes, or both. Each step has prose and an ordered list of **places** in code, optionally with exact quotes and labels. Empty lists are valid. Markdown and Mermaid work in the prose.

To try one, give your agent this prompt:

> Write a Tandem walk explaining this project's main execution path. Follow https://github.com/saiashirwad/tandem/blob/main/WALKS.md and save it to `.tandem/walk.json`. Use a few focused steps with real file paths and unique, exact code quotes.

Open **Walk** in the activity bar. Click a step to open its first place and highlight its quote, or use **Alt+]** and **Alt+[** to move between steps. All places appear below the body; clicking one opens it without changing the focused step. Tandem remembers your place. Saving the walk updates the view.

```json
{
  "title": "Read the review model",
  "steps": [
    {
      "id": "notes",
      "title": "Each step has a note",
      "body": "The reader records text and an optional check.",
      "places": [{ "file": "src/review.ts", "quote": "export function setNote(" }]
    }
  ]
}
```

### Notes and optional traits

Every step has a note box. A walk can also add either or both of these top-level options:

- `"check": "Approve"` adds that labeled checkbox to every step. Use the checkbox control; there is no toggle command or Alt+Enter binding.
- `"compare": { "base": "main", "head": "feature" }` adds per-place +/− counts and **Open diff**.
- Combine them, for example `"check": "Keep"` alongside `"compare": { "base": "main" }`. Omitting both gives a plain explanation.

Compare uses the merge-base of base and head on the left. With `head` omitted, HEAD determines the merge-base and the right side is the real working tree, including uncommitted edits and untracked files. Counts use disk content even after index removals. Native Git compares committed blobs directly, or a base streamed through stdin against disk; no temporary files or index writes are needed. Explicit head opens read-only committed content, preserving case-distinct Git paths even on a case-insensitive filesystem. Place navigation prefers the head side, falling back to base for deleted files. Branch refs must already exist locally; Tandem never fetches, checks out, or merges.

Unquoted counts cover the whole file. Quoted counts include exactly the zero-context hunks intersecting the unique quote's whole lines on either version, each hunk once. No intersection gives +0/−0; missing or ambiguous quotes make scoped counts unavailable. **Open diff** still opens the full files when endpoints are usable, with quote-based reveal. Each path is compared independently; additions/deletions use an empty side. Binary files, symlinks, submodules and Git failures show an unavailable reason without blocking prose or notes.

A file-specific comparison failure affects only that place's comparison; readable head/disk navigation and other places still work. Plain walks can follow in-workspace symlinks. Whole-line highlights include quoted blank lines.

Counts and place ranges are prepared once per walk load. Save the walk again to refresh them; navigating, typing notes, editing source, and opening diffs do not refresh counts. Native working-tree diffs remain live. A hypothetical edit belongs in an ordinary Markdown `diff` fence, not a comparison; neither applies an edit.

A collapsed step shows ✓ when checked and ✎ when it has text. **Submit Review** stamps the time and copies only steps with text or a check, in walk order, followed by your annotations. With a checkbox label, headings read `[x] Keep — Step title` (or `[ ]`); otherwise just the title. Paste the review back to the agent, or ask it to read `.tandem/review.json`.

Reviews survive reloads as sparse notes keyed by step id, each `{ "ok": false, "text": "…" }`. False/empty notes are omitted; without `check`, `ok` is false. Notes follow surviving ids even if prose changes. A new title starts an empty review. Walks are disposable: Tandem does not track staleness or treat a check as approval of exact text. Submission clears nothing and does not notify an agent.

This is a breaking format change: old walk and review files are rejected, not migrated. Invalid walks leave the last good document visible; unreadable reviews are not overwritten.

Tandem works through workspace files and copied text. The extension needs no agent account or API key. See [Writing walks](./WALKS.md) for the format and instructions for agents.

### Agent skill

The companion [Tandem skill](./skills/tandem/SKILL.md) teaches agents to write explanations and proposals, interpret reviews and annotations, and revise walks while preserving the reader's place. Copy the entire `skills/tandem/` folder into your agent's skills directory, including `references/` and `scripts/`. For example, Claude Code project skills live in `.claude/skills/tandem/`.

Then ask: “Use Tandem to explain the request path,” “Propose this refactor as a Tandem walk,” or “Read my Tandem review and address each note.”

The skill includes a read-only [authoring validator](./skills/tandem/references/walk-format.md#validation) for the walk format, places, comparison anchors and Markdown links. It requires Python 3.9+ and no extra packages; comparison needs local Git and refs. Diff fences are prose, not validated patches.

## Commands

Commands are available in the command palette under **Tandem**.

| Command              | Shortcut | Action                                    |
| -------------------- | -------- | ----------------------------------------- |
| Annotate Selection   | Alt+A    | Annotate code or add to a thread          |
| Annotate File        |          | Annotate the whole file                   |
| Copy Tandem Session  |          | Copy all annotations with their snippets  |
| Clear Tandem Session |          | Delete all annotations                    |
| Next Step            | Alt+]    | Focus the next step                       |
| Previous Step        | Alt+[    | Focus the previous step                   |
| Go to Current Step   |          | Return to the focused step's code         |
| Unfocus Step         |          | Remove the code highlight                 |
| Submit Review        |          | Save and copy the review with annotations |
| Clear Walk           |          | Delete the walk and its review            |

## Workspace data

Tandem stores its files in `.tandem/` at the workspace root:

- `session.json` — your annotations.
- `walk.json` — the agent's walk.
- `review.json` — your notes and last submission time.

Tandem adds this folder to `.git/info/exclude`, leaving your project's `.gitignore` unchanged. Clearing annotations leaves the walk alone; clearing the walk leaves annotations alone.

## Development

Install Node.js 24 or later and [Bun](https://bun.sh/) 1.4.0, then run:

```sh
bun install --frozen-lockfile
bun run build
```

Press **F5** to open an Extension Development Host. To use the extension in your regular window, run **Developer: Install Extension from Location…** and select this folder. Run `bun run watch` while editing, then **Developer: Reload Window** after rebuilding.

`bun run package` runs type, lint, and formatting checks and builds a self-contained VSIX in `dist/`. Install it with **Extensions: Install from VSIX…**. Users do not need Bun or a separate Node.js installation. CI also produces a downloadable VSIX on pushes to `main` and pull requests.

Run `bun run test` for comparison/place regressions and the validator's disposable-repository tests (Python 3.9+). These check that preparation preserves the index and working tree; native VS Code UI still needs manual verification.

Before releasing, try annotations, walks, diagrams, diffs, review submission, and persistence after reload in a fresh VS Code profile, including on the minimum supported version. Upload updates through the [Marketplace publisher page](https://marketplace.visualstudio.com/manage).

## Feedback

[Report a bug or request a feature](https://github.com/saiashirwad/tandem/issues).

## License

[MIT](./LICENSE)
