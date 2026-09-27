import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as v from 'valibot'
import { StepId, type Step, type Walk } from './walk-data.ts'

// A proposal as it stood when you approved it; if the agent changes any of this, the approval no longer holds.
const Approved = v.strictObject({
  body: v.string(),
  details: v.optional(v.string()),
  quote: v.optional(v.string()),
  diff: v.optional(v.string()),
})

const StepReview = v.strictObject({ id: StepId, response: v.optional(v.string()), approved: v.optional(Approved) })

const Review = v.strictObject({
  title: v.string(),
  submittedAt: v.optional(
    v.pipe(
      v.string(),
      v.check((value) => Number.isFinite(Date.parse(value)), 'Expected a valid timestamp'),
    ),
  ),
  steps: v.array(StepReview),
})

export type Review = v.InferOutput<typeof Review>

export function reviewPath(root: string) {
  return join(root, '.tandem', 'review.json')
}

export function emptyReview(title: string): Review {
  return { title, steps: [] }
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

function approvedAs({ body, details, quote, diff }: Step) {
  return { body, details, quote, diff }
}

function unchanged(approved: v.InferOutput<typeof Approved>, step: Step) {
  const now = approvedAs(step)

  return (
    approved.body === now.body &&
    approved.details === now.details &&
    approved.quote === now.quote &&
    approved.diff === now.diff
  )
}

// Keeps what still applies to the rewritten walk: responses on steps that remain, and approvals of unchanged proposals.
export function fitReview(review: Review, walk: Walk): Review {
  if (review.title !== walk.title) return emptyReview(walk.title)
  const steps = new Map(walk.steps.map((step) => [step.id, step]))
  const kept: Review['steps'] = []

  for (const entry of review.steps) {
    const step = steps.get(entry.id)
    const approved = step?.proposal && entry.approved && unchanged(entry.approved, step) ? entry.approved : undefined

    if (step && (entry.response || approved)) kept.push({ id: entry.id, response: entry.response, approved })
  }

  return { ...review, steps: kept }
}

function withStep(review: Review, id: string, change: (entry: Review['steps'][number]) => Review['steps'][number]) {
  const current = review.steps.find((entry) => entry.id === id) ?? { id }
  const next = change(current)
  const others = review.steps.filter((entry) => entry.id !== id)

  return { ...review, steps: next.response || next.approved ? [...others, next] : others }
}

export function setResponse(review: Review, id: string, text: string) {
  return withStep(review, id, (entry) => ({ ...entry, response: text.trim() ? text : undefined }))
}

export function setApproval(review: Review, step: Step, approved: boolean) {
  return withStep(review, step.id, (entry) => ({ ...entry, approved: approved ? approvedAs(step) : undefined }))
}

export function formatReview(review: Review, walk: Walk) {
  const entries = new Map(review.steps.map((entry) => [entry.id, entry]))
  const heading = (step: Step) => `## ${walk.steps.indexOf(step) + 1}. ${step.title} (\`${step.id}\`)`
  const blocks = [`# Review of the walk "${walk.title}"`]

  for (const step of walk.steps) {
    if (!step.proposal) continue
    const entry = entries.get(step.id)
    const verdict = entry?.approved ? 'Approved.' : 'Not approved.'
    blocks.push([`${heading(step)}: proposal`, verdict, entry?.response].filter(Boolean).join('\n\n'))
  }

  for (const step of walk.steps) {
    const response = entries.get(step.id)?.response

    if (!step.proposal && response) blocks.push(`${heading(step)}\n\n${response}`)
  }

  return blocks.join('\n\n')
}
