import { describe, expect, it } from 'vitest'
import {
  BOTTOM_POSITION,
  TRANSCRIPT_BOTTOM_THRESHOLD_PX,
  USER_SCROLL_WINDOW_MS,
  anchorFromRects,
  isUserScroll,
  positionAfterScroll,
  restoreTarget,
} from './transcriptPosition'

describe('anchorFromRects', () => {
  it('takes the topmost row that is still partly visible', () => {
    expect(
      anchorFromRects([
        { key: 'gone', top: -300, bottom: -80 },
        { key: 'half', top: -24, bottom: 40 },
        { key: 'next', top: 40, bottom: 120 },
      ]),
    ).toEqual({ mode: 'anchor', key: 'half', offset: 24 })
  })

  it('has no anchor when everything is scrolled past', () => {
    expect(anchorFromRects([{ key: 'gone', top: -40, bottom: -1 }])).toBeNull()
  })
})

describe('positionAfterScroll', () => {
  const anchor = { mode: 'anchor' as const, key: 'row', offset: 10 }

  it('stays on the newest row while the viewport is close to it', () => {
    expect(positionAfterScroll(TRANSCRIPT_BOTTOM_THRESHOLD_PX, anchor)).toEqual(BOTTOM_POSITION)
    expect(positionAfterScroll(0, anchor)).toEqual(BOTTOM_POSITION)
  })

  it('remembers the row being read once the reader scrolls away', () => {
    expect(positionAfterScroll(400, anchor)).toEqual(anchor)
  })

  it('stays on the newest row when no row could be read', () => {
    expect(positionAfterScroll(400, null)).toEqual(BOTTOM_POSITION)
  })
})

describe('restoreTarget', () => {
  it('anchors to the remembered row, keeping the offset into it', () => {
    expect(restoreTarget({ mode: 'anchor', key: 'row', offset: 24 }, () => 100042)).toEqual({
      index: 100042,
      align: 'start',
      offset: 24,
    })
  })

  it('falls back to the newest row when the remembered row is gone', () => {
    expect(restoreTarget({ mode: 'anchor', key: 'row', offset: 24 }, () => null)).toEqual({
      index: 'LAST',
      align: 'end',
      offset: 0,
    })
  })

  it('follows the newest row for the bottom position', () => {
    expect(restoreTarget(BOTTOM_POSITION, () => 1)).toEqual({ index: 'LAST', align: 'end', offset: 0 })
  })
})

// The list scrolls by itself (initial position, prepends, streaming follow). Only
// a scroll that follows the reader's own wheel/touch/key may become "the row I am
// reading": remembering one of the others put the oldest row in that slot, and
// every later restore jumped to the beginning of the conversation.
describe('isUserScroll', () => {
  it('accepts a scroll that follows a wheel/touch/key right away', () => {
    expect(isUserScroll(1_000, 1_050)).toBe(true)
    expect(isUserScroll(1_000, 1_000 + USER_SCROLL_WINDOW_MS)).toBe(true)
  })

  it('rejects a scroll with no reader intent behind it', () => {
    expect(isUserScroll(0, 5_000)).toBe(false)
  })

  it('rejects a scroll that arrives long after the last intent', () => {
    expect(isUserScroll(1_000, 1_001 + USER_SCROLL_WINDOW_MS)).toBe(false)
  })
})
