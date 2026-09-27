import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { excludeFromGit } from './git.ts'

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

  const session: Session = JSON.parse(readFileSync(path, 'utf8'))

  if (!Array.isArray(session?.annotations)) throw new Error('it has no "annotations" list')

  return session
}

export function save(root: string, session: Session) {
  const path = sessionPath(root)

  if (!existsSync(path)) excludeFromGit(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(session, null, 2) + '\n')
}

function sessionPath(root: string) {
  return join(root, '.tandem', 'session.json')
}
