# Writing walks

Use the maintained [Tandem skill](./skills/tandem/SKILL.md) and its [walk format](./skills/tandem/references/walk-format.md). For comparisons, also read [branch walks](./skills/tandem/references/branch-walk.md); for the reader's saved input, read [reader input](./skills/tandem/references/reader-input.md).

Write `.tandem/walk.json` at the VS Code workspace root. Every step requires an ordered `places` array, including `[]` for prose-only steps. Optional walk-wide `check` and `compare` compose independently. The [JSON schema](./schemas/walk.schema.json) describes the strict current format; old files are not migrated.
