import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as v from 'valibot'
import { StepId, type Walk } from './walk-data.ts'

const Note = v.strictObject({ ok: v.boolean(), text: v.string() })

export type Note = v.InferOutput<typeof Note>

// record() discards keys such as __proto__; step ids have no such restriction.
const Notes = v.pipe(
  v.custom<object>((input) => input instanceof Object && Object.getPrototypeOf(input) === Object.prototype),
  v.transform(Object.entries),
  v.array(v.tuple([StepId, Note])),
  v.transform((entries) => Object.fromEntries(entries)),
)

const Review = v.strictObject({
  title: v.string(),
  submitted: v.optional(
    v.pipe(
      v.string(),
      v.check((value) => Number.isFinite(Date.parse(value)), 'Expected a valid timestamp'),
    ),
  ),
  notes: Notes,
})

export type Review = v.InferOutput<typeof Review>

export function reviewPath(root: string) {
  return join(root, '.tandem', 'review.json')
}

export function emptyReview(title: string): Review {
  return { title, notes: {} }
}

export function loadReview(root: string): Review {
  const path = reviewPath(root)

  return existsSync(path) ? v.parse(Review, JSON.parse(readFileSync(path, 'utf8'))) : emptyReview('')
}

export function saveReview(root: string, review: Review) {
  const path = reviewPath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(review, null, 2) + '\n')
}

export function removeReview(root: string) {
  rmSync(reviewPath(root), { force: true })
}

export function fitReview(review: Review, walk: Walk): Review {
  if (review.title !== walk.title) return emptyReview(walk.title)
  let fitted: Review = { ...review, notes: {} }

  for (const step of walk.steps) {
    const note = noteFor(review, step.id)
    fitted = setNote(fitted, step.id, { ...note, ok: walk.check !== undefined && note.ok })
  }

  return fitted
}

export function noteFor(review: Review, id: string): Note {
  return Object.hasOwn(review.notes, id) ? review.notes[id] : { ok: false, text: '' }
}

export function setNote(review: Review, id: string, change: Partial<Note>): Review {
  const next = { ...noteFor(review, id), ...change }

  if (!next.text.trim()) next.text = ''
  const notes = { ...review.notes, [id]: next }

  if (!next.ok && !next.text) delete notes[id]

  return { ...review, notes }
}

export function formatReview(review: Review, walk: Walk) {
  const blocks = [`Review: ${walk.title}${review.submitted ? `  (submitted ${review.submitted})` : ''}`]

  for (const step of walk.steps) {
    const note = noteFor(review, step.id)

    if (!note.ok && !note.text) continue
    const prefix = walk.check === undefined ? '' : `[${note.ok ? 'x' : ' '}] ${walk.check} — `
    blocks.push(
      `${prefix}${step.title}${
        note.text
          ? '\n' +
            note.text
              .split('\n')
              .map((line) => `    ${line}`)
              .join('\n')
          : ''
      }`,
    )
  }

  return blocks.join('\n\n')
}
