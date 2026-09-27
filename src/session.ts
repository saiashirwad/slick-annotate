import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import * as v from 'valibot'
import { FilePath, Index } from './validation.ts'

const Position = v.object({ line: Index, character: Index })

const Range = v.pipe(
  v.object({ start: Position, end: Position }),
  v.check(
    ({ start, end }) => end.line > start.line || (end.line === start.line && end.character >= start.character),
    'Range end must not precede its start',
  ),
)

const ThreadAnchor = v.object({
  threadId: v.pipe(v.string(), v.nonEmpty()),
  file: FilePath,
  range: v.optional(Range),
  snippet: v.string(),
})

const Annotation = v.pipe(
  v.object({
    ...ThreadAnchor.entries,
    id: v.pipe(v.string(), v.nonEmpty()),
    body: v.string(),
    createdAt: v.pipe(
      v.string(),
      v.check((value) => Number.isFinite(Date.parse(value)), 'Expected a valid timestamp'),
    ),
  }),
  v.check(
    (annotation) => annotation.range !== undefined || annotation.snippet === '',
    'Whole-file annotations must have an empty snippet',
  ),
)

const Session = v.object({ annotations: v.array(Annotation) })

export type Range = v.InferOutput<typeof Range>

export type ThreadAnchor = v.InferOutput<typeof ThreadAnchor>

export type Annotation = v.InferOutput<typeof Annotation>

export type Session = v.InferOutput<typeof Session>

export function load(root: string): Session {
  const path = sessionPath(root)

  if (!existsSync(path)) return { annotations: [] }

  return parseSession(readFileSync(path, 'utf8'))
}

export function parseSession(source: string): Session {
  const session = v.parse(Session, JSON.parse(source))
  const ids = new Set<string>()
  const anchors = new Map<string, ThreadAnchor>()

  for (const annotation of session.annotations) {
    if (ids.has(annotation.id)) throw new Error(`Duplicate annotation ID: ${annotation.id}`)
    const { threadId, file, range, snippet } = annotation
    const anchor = { threadId, file, range, snippet }
    const previous = anchors.get(threadId)

    if (previous && !isDeepStrictEqual(previous, anchor)) {
      throw new Error(`Thread ${threadId} has inconsistent locations or snippets`)
    }

    ids.add(annotation.id)
    anchors.set(threadId, anchor)
  }

  return session
}

export function save(root: string, session: Session) {
  const path = sessionPath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(session, null, 2) + '\n')
}

function sessionPath(root: string) {
  return join(root, '.tandem', 'session.json')
}
