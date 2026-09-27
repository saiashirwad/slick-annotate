# Tandem

- A VS Code extension for reading code with a coding agent.
- Write annotations on code and copy them into your next prompt.
- Follow agent-written tours, with each step linked to the code.

## Install

- Clone the repository and run `npm install`.
- Run **Developer: Install Extension from Location…** and select the folder.

## Annotations

- Select code and press **Alt+A** to write an annotation. With nothing selected, press it inside an existing thread to add to it.
- Use **Annotate File** in the editor title bar or explorer context menu for an annotation about the whole file.
- Browse your annotations in VS Code's **Comments** panel.
- **Copy Tandem Session** copies your annotations with file paths and code snippets, ready to paste into an agent.
- **Clear Tandem Session** deletes every annotation. Copy and Clear are in the Comments panel title bar and command palette.

## Tours

- Have your agent write a tour to `.tandem/tour.json` using the [tour format](./TOURS.md).
- Open **Tour** in the activity bar.
- Click a step to open its file and highlight its code.
- Use **Alt+] / Alt+[** to move between steps.
- Your place is remembered when you leave and come back.

## Workspace

- Annotations are saved in `.tandem/session.json`; tours live in `.tandem/tour.json`. The folder is excluded from git.
- Multi-root workspaces use the first folder. Only files inside it can be annotated.
