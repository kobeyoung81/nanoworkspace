// The draft the conversation is filling, for the parts of the screen that are
// not the composer.
//
// The confirmation card lives above the composer and the questions live in the
// transcript, so the progress line ("目标补全 3/6 · 还差：预算") has no way to
// reach the composer's state. A tiny module-level store carries the one thing
// they share — the draft id — instead of threading a context through both.

import type { GoalVerdict } from './goalApi'

export type IntakeDraft = {
  draftId: string
  sessionKey: string
}

let current: IntakeDraft | null = null
const listeners = new Set<(draft: IntakeDraft | null) => void>()

/** setIntakeDraft records the draft being filled (null clears it). */
export function setIntakeDraft(draft: IntakeDraft | null): void {
  current = draft
  for (const listener of listeners) listener(draft)
}

/** getIntakeDraft returns the draft being filled, if any. */
export function getIntakeDraft(): IntakeDraft | null {
  return current
}

/** onIntakeDraftChange subscribes; it returns the unsubscribe. */
export function onIntakeDraftChange(listener: (draft: IntakeDraft | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** describeProgress renders "目标补全 3/6 · 还差：预算、不许动". */
export function describeProgress(
  verdict: Pick<GoalVerdict, 'filled' | 'missing'> | undefined,
  labels: (key: string) => string,
): string {
  const filled = verdict?.filled?.length ?? 0
  const missing = verdict?.missing ?? []
  if (missing.length === 0) {
    return `目标补全 ${filled}/6`
  }
  return `目标补全 ${filled}/6 · 还差：${missing.map(labels).join('、')}`
}
