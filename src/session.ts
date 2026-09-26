import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type Position = { line: number; character: number }
export type Range = { start: Position; end: Position }

export type Annotation = {
  id: string
  threadId: string
  file: string
  range?: Range // absent for a whole-file annotation
  snippet: string
  body: string
  createdAt: string
}

export type Session = { annotations: Annotation[] }

export function load(root: string): Session {
  const path = sessionPath(root)
  if (!existsSync(path)) return { annotations: [] }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function save(root: string, session: Session) {
  const path = sessionPath(root)
  if (!existsSync(path)) excludeFromGit(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(session, null, 2) + '\n')
}

function sessionPath(root: string) {
  return join(root, '.slick', 'session.json')
}

// .git/info/exclude is a per-clone ignore list: keeps .slick/ out of git without touching tracked files.
function excludeFromGit(root: string) {
  let exclude: string
  try {
    exclude = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return
  }
  const file = resolve(root, exclude)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split('\n').includes('.slick/')) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + '.slick/\n')
}
