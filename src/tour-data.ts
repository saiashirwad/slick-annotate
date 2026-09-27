import * as v from 'valibot'
import { FilePath, Index } from './validation.ts'

export const Quote = v.pipe(v.string(), v.nonEmpty())

const Ref = v.strictObject({ file: FilePath, quote: v.optional(Quote), label: v.optional(v.string()) })

const Step = v.pipe(
  v.strictObject({
    title: v.string(),
    body: v.string(),
    details: v.optional(v.string()),
    file: v.optional(FilePath),
    quote: v.optional(Quote),
    refs: v.optional(v.array(Ref)),
  }),
  v.check((step) => step.quote === undefined || step.file !== undefined, 'A quote requires a file'),
)

// schemas/tour.schema.json describes the same file for editors; change both together.
export const Tour = v.strictObject({ $schema: v.optional(v.string()), title: v.string(), steps: v.array(Step) })

// Where you are in the tour with this title. Another title starts afresh.
export const Progress = v.object({
  title: v.string(),
  step: v.pipe(v.number(), v.safeInteger()),
  focused: v.boolean(),
  opened: v.array(v.pipe(v.number(), v.safeInteger())),
})

export type Ref = v.InferOutput<typeof Ref>

export type Step = v.InferOutput<typeof Step>

export type Tour = v.InferOutput<typeof Tour>

export type Progress = v.InferOutput<typeof Progress>

// Fits saved progress to the tour, so every consumer can rely on: the step exists, open steps exist, and a focused step is open.
export function normalizeProgress(saved: Progress | undefined, tour: Tour | undefined): Progress {
  const title = tour?.title ?? ''
  const count = tour?.steps.length ?? 0

  if (!saved || saved.title !== title) {
    return { title, step: 0, focused: count > 0, opened: count > 0 ? [0] : [] }
  }

  const step = Math.max(0, Math.min(saved.step, Math.max(0, count - 1)))
  const focused = saved.focused && count > 0
  const opened = new Set(saved.opened.filter((index) => v.is(Index, index) && index < count))

  if (focused) opened.add(step)

  return { title, step, focused, opened: [...opened] }
}
