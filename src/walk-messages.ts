import * as v from 'valibot'
import { Quote, StepId } from './walk-data.ts'
import { FilePath, Index } from './validation.ts'

export type ComparisonState =
  | { status: 'pending' }
  | { status: 'available'; added: number; removed: number; openable: true }
  | { status: 'unavailable'; reason: string; openable: boolean }

// One user action from media/walk.js. `documentId` names the page it came from, so actions from a replaced page are dropped.
export const FromPage = v.strictObject({
  documentId: Index,
  action: v.variant('type', [
    v.strictObject({ type: v.literal('focusStep'), id: StepId }),
    v.strictObject({ type: v.literal('collapseStep'), id: StepId }),
    v.strictObject({ type: v.literal('openCode'), file: FilePath, quote: v.optional(Quote) }),
    v.strictObject({ type: v.literal('openPlace'), id: StepId, place: Index }),
    v.strictObject({ type: v.literal('openDiff'), id: StepId, place: Index }),
    v.strictObject({ type: v.literal('setCheck'), id: StepId, ok: v.boolean() }),
    v.strictObject({ type: v.literal('setText'), id: StepId, text: v.string() }),
    v.strictObject({ type: v.literal('ready') }),
  ]),
})

export type FromPage = v.InferOutput<typeof FromPage>

// The whole of the reader's place and review, sent after every change. `reveal` scrolls the focused step to the top,
// `preserve` keeps it where it is on screen, and `none` leaves the scroll alone, for changes that move nothing.
export type ToPage = {
  focusedStep: string | null
  opened: string[]
  notes: Record<string, { ok: boolean; text: string }>
  places: { id: string; items: { ready: boolean; reason?: string; comparison?: ComparisonState }[] }[]
  scroll: 'preserve' | 'reveal' | 'none'
}
