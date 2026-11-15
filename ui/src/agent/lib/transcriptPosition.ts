// Where the transcript viewport should be.
//
// The position is deliberately not a pixel offset. Rows are measured lazily,
// older history is prepended above them, and the pane is hidden and shown again —
// so a number captured in pixels is stale the moment anything above it changes
// (which is exactly what used to make a pane come back at the top of the list).
// "Follow the newest row" or "the row the reader parked on, plus how far into it
// they had scrolled" survives all three.

/** The reader is on the newest row and wants to stay there. */
export type BottomPosition = { mode: 'bottom' }
/** The reader parked on a row: its key, and how far into it they had scrolled. */
export type AnchorPosition = { mode: 'anchor'; key: string; offset: number }
export type TranscriptPosition = BottomPosition | AnchorPosition

export const BOTTOM_POSITION: BottomPosition = { mode: 'bottom' }

/** Slack inside which the viewport still counts as being on the newest row (px). */
export const TRANSCRIPT_BOTTOM_THRESHOLD_PX = 40
/** Distance from the bottom at which the "go to latest" affordance shows (px). */
export const TRANSCRIPT_JUMP_DISTANCE_PX = 200

/** A rendered row as the scroller sees it now (viewport coordinates, px). */
export type RowRect = { key: string; top: number; bottom: number }

/**
 * The row the reader is looking at: the topmost rendered row that is not fully
 * scrolled past. `offset` is how much of it sits above the viewport edge, so
 * restoring it puts the same text back at the same place.
 */
export function anchorFromRects(rects: readonly RowRect[]): AnchorPosition | null {
  for (const rect of rects) {
    if (rect.bottom > 0) {
      return { mode: 'anchor', key: rect.key, offset: Math.max(0, -rect.top) }
    }
  }
  return null
}

/**
 * What to remember after a scroll: the newest row while the viewport is close
 * enough to it, otherwise the row being read.
 */
export function positionAfterScroll(
  distanceFromBottom: number,
  anchor: AnchorPosition | null,
  threshold = TRANSCRIPT_BOTTOM_THRESHOLD_PX,
): TranscriptPosition {
  if (anchor && distanceFromBottom > threshold) {
    return anchor
  }
  return BOTTOM_POSITION
}

/** Where to put the list back. `LAST` is the library's own "newest row". */
export type RestoreTarget = { index: 'LAST' | number; align: 'start' | 'end'; offset: number }

/**
 * The scroll the list has to perform to show `position` again.
 *
 * A row that is no longer in the list (its segment was replaced, or the pane now
 * shows another conversation) cannot be anchored to: the newest row is the honest
 * fallback, since a conversation opened without a remembered row should read like
 * a conversation opened for the first time.
 */
export function restoreTarget(
  position: TranscriptPosition,
  indexOf: (key: string) => number | null,
): RestoreTarget {
  if (position.mode === 'anchor') {
    const index = indexOf(position.key)
    if (index !== null) {
      return { index, align: 'start', offset: position.offset }
    }
  }
  return { index: 'LAST', align: 'end', offset: 0 }
}
