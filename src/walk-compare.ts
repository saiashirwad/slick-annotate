import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import * as v from 'valibot'
import { comparisonEndpoints, git, revisionText, textContent, treeFiles } from './git.ts'
import { FilePath } from './validation.ts'
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

type ReadVersion = { version: Version; reason?: never } | { version?: never; reason: string }

export async function plainDiskText(root: string, file: string) {
  const path = await realpath(join(root, file))

  if (!v.is(FilePath, relative(await realpath(root), path))) throw new Error('Place resolves outside the workspace')

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

export async function prepareComparison(root: string, compare: NonNullable<Walk['compare']>, files: string[]) {
  if (!files.length) return new Map<string, FileComparison>()
  root = await realpath(root)
  const { repo, base, head } = await comparisonEndpoints(root, compare.base, compare.head)
  const paths = [...new Set(files.map((file) => relative(repo, join(root, file)).split('\\').join('/')))]

  const [beforeModes, afterModes] = await Promise.all([
    treeFiles(repo, base, paths),
    head ? treeFiles(repo, head, paths) : Promise.resolve(undefined),
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
  const before = (file: string) => committed(base, file, beforeModes.get(file))

  const after = (file: string) => {
    if (head) return committed(head, file, afterModes?.get(file))

    if (!disk.has(file))
      disk.set(
        file,
        readVersion({ disk: join(repo, file) }, () => diskText(repo, file)),
      )

    return disk.get(file)!
  }

  const destinations: string[] = []

  for (const file of paths) {
    if (!beforeModes.has(file) && (await after(file)).version?.exists) destinations.push(file)
  }

  const sources: string[] = []
  let renameProblem: string | undefined

  // Existing-file walks do not inspect unrelated paths for possible renames.
  if (destinations.length) {
    try {
      const baseTree = await treeFiles(repo, base)
      const headTree = head ? await treeFiles(repo, head) : undefined

      for (const [file, mode] of baseTree) {
        beforeModes.set(file, mode)

        if (headTree) {
          if (!headTree.has(file)) sources.push(file)
        } else {
          try {
            await lstat(join(repo, file))
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') sources.push(file)
          }
        }
      }
    } catch (error) {
      renameProblem = errorMessage(error)
    }
  }

  return new Map(
    await Promise.all(
      [...new Set(files)].map(async (file): Promise<[string, FileComparison]> => {
        const path = relative(repo, join(root, file)).split('\\').join('/')
        const right = await after(path)
        let left = await before(path)
        let target = right.version?.exists ? right.version : right.version ? left.version : undefined

        try {
          if (destinations.includes(path) && renameProblem) throw new Error(renameProblem)

          if (!beforeModes.has(path) && right.version?.exists && sources.length) {
            let best = 0.5
            let ambiguous = false

            for (const source of sources) {
              const candidate = await before(source)

              if (!candidate.version?.exists) continue
              const hunks = await diffVersions(repo, candidate.version, right.version)

              const score =
                candidate.version.text === right.version.text
                  ? 1
                  : (lineCount(candidate.version.text) - hunks.reduce((n, h) => n + h.oldCount, 0)) /
                    Math.max(lineCount(candidate.version.text), lineCount(right.version.text), 1)

              if (score < best) continue

              if (score === best && left.version?.exists) {
                ambiguous = true
                continue
              }

              best = score
              left = candidate
              ambiguous = false
            }

            if (ambiguous) throw new Error('Rename source is ambiguous')
          }

          target = right.version?.exists ? right.version : right.version ? left.version : undefined
          const reason = left.reason ?? right.reason

          if (reason || !left.version || !right.version)
            return [file, { reason: reason ?? 'Comparison unavailable', target }]

          if (!left.version.exists && !right.version.exists) throw new Error('File is absent from both versions')

          return [
            file,
            {
              file: {
                before: left.version,
                after: right.version,
                hunks: await diffVersions(repo, left.version, right.version),
              },
            },
          ]
        } catch (error) {
          return [file, { reason: errorMessage(error), target }]
        }
      }),
    ),
  )
}

async function readVersion(endpoint: Endpoint, read: () => Promise<string | undefined>): Promise<ReadVersion> {
  try {
    const text = await read()

    return { version: { endpoint, text: text ?? '', exists: text !== undefined } }
  } catch (error) {
    return { reason: errorMessage(error) }
  }
}

function lineCount(text: string) {
  return text ? text.split('\n').length - Number(text.endsWith('\n')) : 0
}

async function diffVersions(repo: string, before: Version, after: Version): Promise<Hunk[]> {
  if (before.text === after.text) return []

  if (!before.exists || !after.exists)
    return [
      {
        oldStart: before.exists ? 1 : 0,
        oldCount: lineCount(before.text),
        newStart: after.exists ? 1 : 0,
        newCount: lineCount(after.text),
      },
    ]
  const left = before.endpoint
  const right = after.endpoint

  if ('disk' in left) throw new Error('Expected a committed base')
  const options = ['--text', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0', '--inter-hunk-context=0']

  // Streaming the base also covers paths removed from the index but still present on disk.
  const output =
    'disk' in right
      ? await git(
          repo,
          ['diff', '--no-index', ...options, '--', '-', right.disk],
          await git(repo, ['show', `${left.revision}:${left.file}`]),
        )
      : await git(repo, ['diff', ...options, `${left.revision}:${left.file}`, `${right.revision}:${right.file}`, '--'])

  return [...output.toString().matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  }))
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
