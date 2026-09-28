import { lstat, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { comparisonEndpoints, git, revisionText, textContent, treeFiles } from './git.ts'
import { errorMessage } from './errors.ts'
import type { LineRange, Located } from './locate.ts'
import type { Walk } from './walk-data.ts'
import type { ComparisonState } from './walk-messages.ts'

export type Endpoint = { repo: string; revision: string; file: string } | { disk: string }

export type Version = { endpoint: Endpoint; text: string; exists: boolean }

export type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number }

export type ComparedFile = { before: Version; after: Version; hunks: Hunk[] }

export type FileComparison = { file: ComparedFile; reason?: never } | { file?: never; reason: string }

type FileChange = { oldFile: string; hunks: Hunk[]; binary: boolean }

export async function diskText(root: string, file: string): Promise<string | undefined> {
  const parts = file.split(/[\\/]/)
  let path = root

  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index])

    try {
      const stat = await lstat(path)

      if (stat.isSymbolicLink()) throw new Error('Symlink')

      if (index === parts.length - 1 && !stat.isFile()) throw new Error('Not a regular file (directory or submodule)')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  return textContent(await readFile(path))
}

export function parseChanges(output: string) {
  const changes = new Map<string, FileChange>()
  const records = output.split('\0')
  let index = 0
  const ordered: FileChange[] = []

  while (records[index]?.startsWith(':')) {
    const metadata = records[index++].split(' ')
    const status = metadata[4]
    const oldFile = records[index++]
    const file = /^[RC]/.test(status) ? records[index++] : oldFile
    const change: FileChange = { oldFile, hunks: [], binary: false }
    changes.set(file, change)
    ordered.push(change)
  }

  const patches = records
    .slice(index)
    .join('\0')
    .replace(/^\0+/, '')
    .split(/^diff --git /m)
    .slice(1)

  if (patches.length !== ordered.length) throw new Error('Cannot pair Git file changes with patches')
  patches.forEach((patch, i) => {
    ordered[i].binary = /^Binary files |^GIT binary patch/m.test(patch)
    ordered[i].hunks = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
      oldStart: Number(match[1]),
      oldCount: Number(match[2] ?? 1),
      newStart: Number(match[3]),
      newCount: Number(match[4] ?? 1),
    }))
  })

  return changes
}

export async function prepareComparison(root: string, compare: NonNullable<Walk['compare']>, files: string[]) {
  const { repo, base, head } = await comparisonEndpoints(root, compare.base, compare.head)

  // Include rename sources outside the places list; filtering by just new paths loses those pairings.
  const [patch, beforeModes, afterModes] = await Promise.all([
    git(repo, [
      'diff',
      '--raw',
      '-z',
      '--patch',
      '--no-abbrev',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--unified=0',
      '--inter-hunk-context=0',
      '--find-renames',
      base,
      ...(head ? [head] : []),
      '--',
    ]),
    treeFiles(repo, base),
    head ? treeFiles(repo, head) : Promise.resolve(undefined),
  ])

  const changes = parseChanges(patch.toString())
  const contents = new Map<string, Promise<string>>()

  const committed = (revision: string, file: string) => {
    const key = `${revision}:${file}`

    if (!contents.has(key)) contents.set(key, revisionText(repo, revision, file))

    return contents.get(key)!
  }

  const entries = await Promise.all(
    [...new Set(files)].map(async (file): Promise<[string, FileComparison]> => {
      try {
        const path = relative(repo, join(root, file)).split('\\').join('/')
        const change = changes.get(path)
        const oldFile = change?.oldFile ?? path
        const oldMode = beforeModes.get(oldFile)
        const newMode = afterModes?.get(path)

        if ([oldMode, newMode].some((mode) => mode && !/^100(644|755)$/.test(mode)))
          throw new Error('Symlink or submodule')

        if (change?.binary) throw new Error('Binary file')

        const [oldText, newText] = await Promise.all([
          oldMode ? committed(base, oldFile) : Promise.resolve(undefined),
          head ? (newMode ? committed(head, path) : Promise.resolve(undefined)) : diskText(root, file),
        ])

        if (oldText === undefined && newText === undefined) throw new Error('File is absent from both versions')
        let hunks = change?.hunks ?? []

        if (!head && oldText === undefined && newText !== undefined && !change) {
          const count = newText ? newText.split('\n').length - (newText.endsWith('\n') ? 1 : 0) : 0
          hunks = count ? [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: count }] : []
        }

        return [
          file,
          {
            file: {
              before: {
                endpoint: { repo, revision: base, file: oldFile },
                text: oldText ?? '',
                exists: oldText !== undefined,
              },
              after: {
                endpoint: head ? { repo, revision: head, file: path } : { disk: join(root, file) },
                text: newText ?? '',
                exists: newText !== undefined,
              },
              hunks,
            },
          },
        ]
      } catch (error) {
        return [file, { reason: errorMessage(error) }]
      }
    }),
  )

  return new Map(entries)
}

function intersects(start: number, count: number, range?: LineRange) {
  return !!range && count > 0 && start <= range.end && start + count - 1 >= range.start
}

export function scopeComparison(file: ComparedFile, before?: Located, after?: Located): ComparisonState {
  if (before || after) {
    if ((before?.count ?? 0) > 1 || (after?.count ?? 0) > 1)
      return { status: 'unavailable', reason: 'Quote is ambiguous in a compared version', openable: true }

    if (!before?.range && !after?.range)
      return { status: 'unavailable', reason: 'Quote not found in either version', openable: true }
  }

  const hunks = scopedHunks(file, before, after)

  return {
    status: 'available',
    added: hunks.reduce((n, h) => n + h.newCount, 0),
    removed: hunks.reduce((n, h) => n + h.oldCount, 0),
    openable: true,
  }
}

export function scopedHunks(file: ComparedFile, before?: Located, after?: Located) {
  return before || after
    ? file.hunks.filter(
        (hunk) =>
          intersects(hunk.oldStart, hunk.oldCount, before?.range) ||
          intersects(hunk.newStart, hunk.newCount, after?.range),
      )
    : file.hunks
}
