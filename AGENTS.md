# Tandem

Two independent features, sharing only the workspace's `.tandem/` folder:

- **Annotations** (`src/annotations.ts`, `session.ts`, `copy.ts`): notes you write, as native comment threads.
- **Walks** (`src/walk.ts`, `walk-data.ts`, `walk-messages.ts`, `walk-page.ts`, `walk-diff.ts`, `review.ts`, `media/`): a walk through the code that an agent writes, shown in a sidebar webview, and your review of it.

Neither imports the other; what both need gets its own module (`lines.ts`, `git.ts`, `validation.ts`, `errors.ts`). `submit.ts` is the one place they meet: it copies the review together with the session.

[SPEC.md](./SPEC.md) says what it does and why it's built this way. [CONTEXT.md](./CONTEXT.md) defines the terms to use.

## Rules

- Bun manages dependencies and bundles `src/extension.ts` to `dist/extension.js` for VS Code's Node extension host, with `vscode` external. Use `.ts` imports. Run `bun run build` (or `bun run watch`) before reloading.
- Stable VS Code API only, so it stays publishable.
- Native UI, except the walk document.
- Comment only what the code can't say.
- Update README.md and SPEC.md with any behaviour change.

## Checking

`bun run check` and `bun run format:check` must pass. `bun run package` runs both checks and the Bun build before producing the VSIX. There are no tests: rebuild, run **Developer: Reload Window** (the extension is installed from this folder), and try the change.

## Publishing

Bump the version and run `bun run package`. Use Codex computer use in Helium to open [the publisher dashboard](https://marketplace.visualstudio.com/manage/publishers/saiashirwad), choose Tandem → More Actions → Update, and upload `dist/tandem-<version>.vsix`. Check Marketplace verification status; no PAT or Azure subscription is needed.
