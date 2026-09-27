import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

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
