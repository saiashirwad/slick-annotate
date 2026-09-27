import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const excluded = new Set<string>()

// .git/info/exclude ignores .tandem/ for this clone without touching any tracked file.
export function excludeFromGit(root: string) {
  if (excluded.has(root)) return
  excluded.add(root)
  let exclude: string

  try {
    exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return
  }

  const file = resolve(root, exclude)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''

  if (current.split('\n').includes('.tandem/')) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + '.tandem/\n')
}
