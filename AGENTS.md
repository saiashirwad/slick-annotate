# Working on Slick Annotate

A VS Code extension with two features that share nothing but the workspace's `.slick/` folder:

- **Annotations**: notes you write on code, shown as native comment threads, saved to `.slick/session.json`.
- **Tours**: a walk through the code that an agent writes to `.slick/tour.json`, shown as a document in the sidebar.

Read these before changing behaviour:

- [SPEC.md](./SPEC.md): what it does, and implementation notes on why it's built this way.
- [CONTEXT.md](./CONTEXT.md): the domain terms. Use them in code, comments and docs, and avoid the words it lists under _Avoid_.

## Layout

| File                 | Holds                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| `src/extension.ts`   | Entry point: activates both features for the first workspace folder                |
| `src/annotations.ts` | Annotating: the comment controller, the commands, threads rebuilt from the session |
| `src/session.ts`     | Reading and writing `.slick/session.json`; keeps `.slick/` out of git              |
| `src/copy.ts`        | The session as Markdown, for Copy Session                                          |
| `src/tour.ts`        | Tours: loading, the highlighted step, the sidebar document's HTML, its commands    |
| `src/lines.ts`       | Snapping a range to whole lines, used by both features                             |
| `media/tour.*`       | The tour document's script and styles. Its messages are typed in `src/tour.ts`     |
| `tools/oxlint/`      | A vendored oxlint plugin (`anti-slop`); see its `UPSTREAM.md`                      |

The features stay independent: neither imports the other. Anything both need goes in its own small module, like `lines.ts`.

## Conventions

- No build step. VS Code's Node strips types at load, so imports use `.ts` extensions and only erasable TypeScript is allowed (no enums, namespaces or parameter properties).
- Only stable VS Code API. Proposed APIs can't be published to the Marketplace (see the input-box note in SPEC.md).
- Native VS Code UI everywhere except the tour document.
- Comments say why, in plain sentences. Keep them as short as the code around them.
- When behaviour changes, update README.md (for users) and SPEC.md (for maintainers) in the same commit.

## Checking a change

- `npm run check` type-checks and lints `src` and `media`, with the anti-slop rules. It must pass.
- `npx prettier --check .` for formatting.
- There are no automated tests. Try changes in VS Code: the extension is installed from this folder, so **Developer: Reload Window** picks them up. The "Run Extension" launch config opens a separate dev host.
