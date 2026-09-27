# Tandem

- A VS Code extension for reading code with a coding agent.
- Write annotations on code and copy them into your next prompt.
- Follow agent-written walks through the code, and approve or respond to what the agent proposes.

## Install

- Requires **VS Code 1.138 or later** and a trusted workspace folder on disk. Virtual workspaces and vscode.dev are not supported. Multi-root workspaces use the first folder.
- To install a packaged release, run **Extensions: Install from VSIX…** and choose `tandem-0.0.1.vsix`.

## Your first walk

Open a project, then give your coding agent this prompt:

> Write a Tandem walk explaining this project's main execution path. Follow https://github.com/saiashirwad/tandem/blob/main/WALKS.md and save it to `.tandem/walk.json`. Use a few focused steps with real file paths and unique, exact code quotes.

Open **Walk** in the activity bar to follow it. Tandem works through local files and copied text; no agent account or API key is required by the extension.

## Annotations

- Select code and press **Alt+A** to write an annotation. With nothing selected, press it inside an existing thread to add to it.
- Use **Annotate File** in the editor title bar or explorer context menu for an annotation about the whole file.
- Browse your annotations in VS Code's **Comments** panel.
- **Copy Tandem Session** copies your annotations with file paths and code snippets, ready to paste into an agent.
- **Clear Tandem Session** deletes every annotation. Copy and Clear are in the Comments panel title bar and command palette.

## Walks

- Have your agent write a walk to `.tandem/walk.json` using the [walk format](./WALKS.md): to explain some code, to propose a change before making it, or both.
- Open **Walk** in the activity bar.
- Click a step to open its file and highlight its code.
- Use **Alt+] / Alt+[** to move between steps.
- A proposal can show its change as a diff. **Open diff** shows it in VS Code's diff editor.
- Approve a proposal with its **Approve this change** checkbox, or **Alt+Enter** on the focused step.
- Write a response on any step in the box under it.
- **Submit Review** (Walk view title bar) copies your approvals, responses and annotations, ready to paste into the agent. It also saves a copy to `.tandem/review.json` for the agent to read.
- Your place and your review are remembered when you leave and come back, and when the agent revises the walk. An approval is kept only if the proposal hasn't changed.

## Workspace

- Annotations are saved in `.tandem/session.json`; walks live in `.tandem/walk.json`, and your review of one in `.tandem/review.json`. The folder is excluded from git.
- Multi-root workspaces use the first folder. Only files inside it can be annotated.

## Development and packaging

- Install Node.js 24 or later (for VS Code's packaging tools) and [Bun](https://bun.sh/) 1.4.0 (the version used in CI). Clone the repository and run `bun install --frozen-lockfile`, then `bun run build`.
- Run **Developer: Install Extension from Location…** and select the folder. Use `bun run watch` while editing, then **Developer: Reload Window** to pick up rebuilt code. F5 builds before opening an Extension Development Host.
- `bun run package` checks types, lint, and formatting, bundles the extension with Bun, then writes the VSIX to `dist/`. Bun manages dependencies through `bun.lock` and targets Node.js; users do not need Bun or a separate Node.js installation. The VSIX is self-contained; `vsce` does not collect `node_modules`.
- Before releasing, install that VSIX in a fresh VS Code profile and check annotations, walks, diagrams, diffs, review submission, and persistence after reload. Repeat on the minimum supported VS Code version.
- Upload the checked VSIX through the [Marketplace publisher page](https://marketplace.visualstudio.com/manage). CI also packages a downloadable VSIX on pushes and pull requests.

## Support and license

[Report a bug or request a feature](https://github.com/saiashirwad/tandem/issues). Licensed under [MIT](./LICENSE).
