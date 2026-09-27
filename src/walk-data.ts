import * as v from 'valibot'
import { FilePath } from './validation.ts'

export const Quote = v.pipe(v.string(), v.nonEmpty())

export const StepId = v.pipe(v.string(), v.nonEmpty())

const Ref = v.strictObject({ file: FilePath, quote: v.optional(Quote), label: v.optional(v.string()) })

const Step = v.pipe(
  v.strictObject({
    id: StepId,
    title: v.string(),
    body: v.string(),
    details: v.optional(v.string()),
    file: v.optional(FilePath),
    quote: v.optional(Quote),
    refs: v.optional(v.array(Ref)),
    proposal: v.optional(v.boolean()),
    diff: v.optional(v.string()),
  }),
  v.check((step) => step.quote === undefined || step.file !== undefined, 'A quote requires a file'),
  v.check((step) => step.diff === undefined || step.proposal === true, 'A diff belongs to a proposal'),
)

// schemas/walk.schema.json describes the same file for editors; change both together.
export const Walk = v.pipe(
  v.strictObject({ $schema: v.optional(v.string()), title: v.string(), steps: v.array(Step) }),
  v.check((walk) => new Set(walk.steps.map((step) => step.id)).size === walk.steps.length, 'Step ids must be unique'),
)

// Where you are in the walk with this title, by step id. Another title starts afresh.
export const Progress = v.object({
  title: v.string(),
  step: v.string(),
  focused: v.boolean(),
  opened: v.array(v.string()),
})

export type Ref = v.InferOutput<typeof Ref>

export type Step = v.InferOutput<typeof Step>

export type Walk = v.InferOutput<typeof Walk>

export type Progress = v.InferOutput<typeof Progress>

// Fits saved progress to the walk, so every consumer can rely on: the step exists, open steps exist, and a focused
// step is open. Only an empty walk has no current step, and then `step` is ''.
export function normalizeProgress(saved: Progress | undefined, walk: Walk | undefined): Progress {
  const title = walk?.title ?? ''
  const ids = new Set(walk?.steps.map((step) => step.id))
  const first = walk?.steps[0]?.id ?? ''

  if (!saved || saved.title !== title) {
    return { title, step: first, focused: first !== '', opened: first ? [first] : [] }
  }

  const kept = ids.has(saved.step)
  const step = kept ? saved.step : first
  const focused = saved.focused && kept
  const opened = new Set(saved.opened.filter((id) => ids.has(id)))

  if (focused) opened.add(step)

  return { title, step, focused, opened: [...opened] }
}
