# Slick Annotate

Two independent features, sharing only the workspace's `.slick/` folder:

- **Annotations** (`src/annotations.ts`, `session.ts`, `copy.ts`): notes you write, as native comment threads.
- **Tours** (`src/tour.ts`, `media/`): a walk through the code that an agent writes, shown in a sidebar webview.

Neither imports the other; what both need gets its own module (`lines.ts`, `git.ts`).

[SPEC.md](./SPEC.md) says what it does and why it's built this way. [CONTEXT.md](./CONTEXT.md) defines the terms to use.

## Rules

- No build step: VS Code strips types at load, so use `.ts` imports and erasable TypeScript only.
- Stable VS Code API only, so it stays publishable.
- Native UI, except the tour document.
- Comment only what the code can't say.
- Update README.md and SPEC.md with any behaviour change.

## Checking

`npm run check` and `npx prettier --check .` must pass. There are no tests: run **Developer: Reload Window** (the extension is installed from this folder) and try the change.
