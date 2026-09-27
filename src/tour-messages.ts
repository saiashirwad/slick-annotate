import * as v from 'valibot'
import { Quote } from './tour-data.ts'
import { FilePath, Index } from './validation.ts'

// One user action from media/tour.js. `documentId` names the page it came from, so actions from a replaced page are dropped.
export const FromPage = v.strictObject({
  documentId: Index,
  action: v.variant('type', [
    v.strictObject({ type: v.literal('focusStep'), index: Index }),
    v.strictObject({ type: v.literal('collapseStep'), index: Index }),
    v.strictObject({ type: v.literal('openCode'), file: FilePath, quote: v.optional(Quote) }),
    v.strictObject({ type: v.literal('ready') }),
  ]),
})

export type FromPage = v.InferOutput<typeof FromPage>

// The whole of the reader's place, sent after every change. `reveal` scrolls the focused step to the top.
export type ToPage = { focusedStep: number | null; opened: number[]; scroll: 'preserve' | 'reveal' }
