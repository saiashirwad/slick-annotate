import { lstat, readFile, realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { comparisonEndpoints, git, revisionText, textContent, treeFiles } from './git.ts'
import { errorMessage } from './errors.ts'
import type { LineRange, Located } from './locate.ts'
import type { Walk } from './walk-data.ts'
import type { ComparisonState } from './walk-messages.ts'

export type Endpoint = { repo: string; revision: string; file: string } | { disk: string }

export type Version = { endpoint: Endpoint; text: string; exists: boolean }

export type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number }

export type ComparedFile = { before: Version; after: Version; hunks: Hunk[] }

export type FileComparison =
  { file: ComparedFile; reason?: never; target?: never } | { file?: never; reason: string; target?: Version }

type FileChange = { oldFile: string; hunks: Hunk[]; binary: boolean; reason?: string }

type ReadVersion = { version: Version; reason?: never } | { version?: never; reason: string }

const diffOptions = [
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
  '--src-prefix=a/',
  '--dst-prefix=b/',
]

export async function plainDiskText(root: string, file: string) {
  const path = await realpath(join(root, file))
  const inside = relative(await realpath(root), path)

  if (inside === '..' || inside.startsWith('../') || isAbsolute(inside))
    throw new Error('Place resolves outside the workspace')

  return textContent(await readFile(path))
}

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

// With core.quotePath=false, only control characters, quotes and backslashes are escaped.
function patchPath(path: string) {
  const needsEscape = (c: string) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '"' || c === '\\'

  if (![...path].some(needsEscape)) return path

  const escapes = new Map([
    ['\x07', '\\a'],
    ['\b', '\\b'],
    ['\t', '\\t'],
    ['\n', '\\n'],
    ['\v', '\\v'],
    ['\f', '\\f'],
    ['\r', '\\r'],
    ['"', '\\"'],
    ['\\', '\\\\'],
  ])

  return (
    '"' +
    [...path]
      .map((c) => (needsEscape(c) ? (escapes.get(c) ?? `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`) : c))
      .join('') +
    '"'
  )
}

export function parseChanges(output: string, snapshot = false) {
  const changes = new Map<string, FileChange>()
  const headers = new Map<string, FileChange>()
  const seen = new Set<FileChange>()
  const records = output.split('\0')
  let index = 0

  while (records[index]?.startsWith(':')) {
    const metadata = records[index++].split(' ')
    const status = metadata[4]
    const oldPath = records[index++]

    const newPath = /^[RC]/.test(status)
      ? records[index++]
      : snapshot && status === 'M'
        ? oldPath.replace(/^before\//, 'after/')
        : oldPath

    const unprefix = (path: string) => (snapshot ? path.replace(/^(before|after)\//, '') : path)
    const change: FileChange = { oldFile: unprefix(oldPath), hunks: [], binary: false }

    if (!/^[AMDRC]/.test(status)) change.reason = `Unsupported Git file change: ${status}`
    changes.set(unprefix(newPath), change)
    headers.set(`${patchPath(`a/${oldPath}`)} ${patchPath(`b/${newPath}`)}`, change)
  }

  const patches = records
    .slice(index)
    .join('\0')
    .replace(/^\0+/, '')
    .split(/^diff --git /m)
    .slice(1)

  patches.forEach((patch) => {
    const change = headers.get(patch.slice(0, patch.indexOf('\n')))

    if (!change) return
    seen.add(change)
    change.binary ||= /^Binary files |^GIT binary patch/m.test(patch)
    change.hunks.push(
      ...[...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? 1),
      })),
    )
  })

  for (const change of changes.values()) {
    if (!seen.has(change)) change.reason = 'Cannot find the Git patch for this file'
  }

  return changes
}

export async function prepareComparison(root: string, compare: NonNullable<Walk['compare']>, files: string[]) {
  root = await realpath(root)
  const { repo, base, head } = await comparisonEndpoints(root, compare.base, compare.head)

  const [beforeModes, afterModes] = await Promise.all([
    treeFiles(repo, base),
    head ? treeFiles(repo, head) : Promise.resolve(undefined),
  ])

  const contents = new Map<string, Promise<ReadVersion>>()

  const committed = (revision: string, file: string, mode: string | undefined) => {
    const key = `${revision}:${file}`

    if (!contents.has(key))
      contents.set(
        key,
        readVersion({ repo, revision, file }, async () => {
          if (mode && !/^100(644|755)$/.test(mode)) throw new Error('Symlink or submodule')

          return mode ? revisionText(repo, revision, file) : undefined
        }),
      )

    return contents.get(key)!
  }

  const disk = new Map<string, Promise<ReadVersion>>()

  const working = (file: string) => {
    if (!disk.has(file))
      disk.set(
        file,
        readVersion({ disk: join(repo, file) }, () => diskText(repo, file)),
      )

    return disk.get(file)!
  }

  const paths = [...new Set(files.map((file) => relative(repo, join(root, file)).split('\\').join('/')))]
  let changes: Map<string, FileChange>
  let diffProblem: string | undefined

  try {
    changes = await snapshotChanges(
      repo,
      beforeModes,
      afterModes,
      paths,
      (file) => committed(base, file, beforeModes.get(file)),
      (file) => (head ? committed(head, file, afterModes?.get(file)) : working(file)),
    )
  } catch (error) {
    changes = new Map()
    diffProblem = errorMessage(error)
  }

  const entries = await Promise.all(
    [...new Set(files)].map(async (file): Promise<[string, FileComparison]> => {
      try {
        const path = relative(repo, join(root, file)).split('\\').join('/')
        const change = changes.get(path)
        const oldFile = change?.oldFile ?? path
        const oldMode = beforeModes.get(oldFile)
        const newMode = afterModes?.get(path)

        const [left, right] = await Promise.all([
          committed(base, oldFile, oldMode),
          head ? committed(head, path, newMode) : working(path),
        ])

        const target = right.version?.exists ? right.version : right.version ? left.version : undefined
        const reason = left.reason ?? right.reason ?? change?.reason ?? (change?.binary ? 'Binary file' : diffProblem)

        if (reason || !left.version || !right.version)
          return [file, { reason: reason ?? 'Comparison unavailable', target }]

        if (!left.version.exists && !right.version.exists) throw new Error('File is absent from both versions')

        return [
          file,
          {
            file: {
              before: left.version,
              after: right.version,
              hunks: change?.hunks ?? [],
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

async function readVersion(endpoint: Endpoint, read: () => Promise<string | undefined>): Promise<ReadVersion> {
  try {
    const text = await read()

    return { version: { endpoint, text: text ?? '', exists: text !== undefined } }
  } catch (error) {
    return { reason: errorMessage(error) }
  }
}

async function snapshotChanges(
  repo: string,
  modes: Map<string, string>,
  headModes: Map<string, string> | undefined,
  paths: string[],
  before: (file: string) => Promise<ReadVersion>,
  after: (file: string) => Promise<ReadVersion>,
) {
  const selected = new Set(paths)

  // Missing base paths are rename candidates, even when the destination was never staged.
  for (const file of modes.keys()) {
    if (headModes) {
      if (!headModes.has(file)) selected.add(file)
      continue
    }

    try {
      await lstat(join(repo, file))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') selected.add(file)
    }
  }

  const temporary = await mkdtemp(join(tmpdir(), 'tandem-compare-'))

  try {
    await Promise.all(['before', 'after'].map((side) => mkdir(join(temporary, side))))
    const failures = new Map<string, FileChange>()

    for (const file of selected) {
      const versions = await Promise.all([before(file), after(file)])
      const reason = versions.find((result) => result.reason)?.reason

      if (reason) {
        failures.set(file, { oldFile: file, hunks: [], binary: false, reason })
        continue
      }

      for (const [index, result] of versions.entries()) {
        if (!result.version?.exists) continue

        try {
          const path = join(temporary, index === 0 ? 'before' : 'after', file)
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, result.version.text)
        } catch (error) {
          failures.set(file, { oldFile: file, hunks: [], binary: false, reason: errorMessage(error) })
        }
      }
    }

    const patch = await git(temporary, [
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-index',
      ...diffOptions,
      '--',
      'before',
      'after',
    ])

    const changes = parseChanges(patch.toString(), true)

    for (const [file, failure] of failures) changes.set(file, failure)

    return changes
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
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
