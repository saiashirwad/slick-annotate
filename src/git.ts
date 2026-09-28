import { execFile, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function git(root: string, args: string[], input?: Buffer) {
  try {
    const running = exec('git', args, {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30000,
      env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' },
    })

    const written = running.child.stdin ? finished(running.child.stdin) : Promise.resolve()
    running.child.stdin?.end(input)
    const [{ stdout }] = await Promise.all([running, written])

    return stdout
  } catch (cause) {
    if (
      args.includes('--no-index') &&
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 1 &&
      'stdout' in cause &&
      Buffer.isBuffer(cause.stdout)
    )
      return cause.stdout

    throw new Error(`Git ${args[0]} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

export async function comparisonEndpoints(root: string, base: string, head?: string) {
  const repo = (await git(root, ['rev-parse', '--show-toplevel'])).toString().trim()

  const revision = async (ref: string) =>
    (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).toString().trim()

  const [baseCommit, headCommit] = await Promise.all([revision(base), revision(head ?? 'HEAD')])
  const bases = (await git(repo, ['merge-base', '--all', baseCommit, headCommit])).toString().trim().split('\n')

  if (bases.length !== 1 || !bases[0]) throw new Error('Comparison needs exactly one merge-base')

  return { repo, base: bases[0], head: head === undefined ? undefined : headCommit }
}

export async function treeFiles(repo: string, revision: string, paths: string[]) {
  const tree = await git(repo, ['ls-tree', '-rz', '--full-tree', revision, '--', ...paths])

  return new Map(
    tree
      .toString()
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf('\t')

        return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')[0]]
      }),
  )
}

export function textContent(bytes: Uint8Array) {
  if (bytes.includes(0)) throw new Error('Binary file')

  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export async function revisionText(repo: string, revision: string, file: string) {
  return textContent(await git(repo, ['show', `${revision}:${file}`]))
}

export function excludeFromGit(root: string) {
  const result = spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  })

  if (result.error) throw result.error

  if (result.status !== 0) {
    if (result.stderr.includes('not a git repository')) return

    throw new Error(result.stderr.trim() || `Git exited with status ${result.status}`)
  }

  const file = resolve(root, result.stdout.trim())
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''

  if (current.split(/\r?\n/).includes('.tandem/')) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + '.tandem/\n')
}
