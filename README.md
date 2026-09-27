# Tandem

- A VS Code extension for reading code with a coding agent.
- Write annotations on code and copy them into your next prompt.
- Follow agent-written walks through the code, and approve or respond to what the agent proposes.

## Install

- Clone the repository and run `npm install`.
- Run **Developer: Install Extension from Location…** and select the folder.

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
