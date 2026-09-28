import { setNote, type Review } from './review.ts'
import type { Walk } from './walk-data.ts'

export function setCheck(review: Review, walk: Walk, id: string, ok: boolean) {
  if (walk.check === undefined || !walk.steps.some((step) => step.id === id)) return

  return setNote(review, id, { ok })
}
