import { describe, expect, it } from 'vitest'
import {
  BASE_FIRST_ITEM_INDEX,
  countPrepended,
  keyAtIndex,
  nextFirstItemIndex,
  positionOfKey,
  sameKeys,
} from './transcriptIndex'

// The list numbers rows in two spaces: the data array (0..n-1) and the virtual
// index space that starts at `firstItemIndex`. The library's `initialTopMostItemIndex`
// and `scrollToIndex` take the *data* position and add the offset themselves;
// handing them a virtual index clamps it to the last row, which is how a
// remembered row used to turn into "the newest message".
describe('positionOfKey', () => {
  it('returns the row offset inside the data array', () => {
    expect(positionOfKey(['a', 'b', 'c'], 'b')).toBe(1)
  })

  it('returns null for a row that is not in the list', () => {
    expect(positionOfKey(['a', 'b'], 'z')).toBeNull()
  })
})

describe('keyAtIndex', () => {
  it('maps a virtual index back to its row', () => {
    expect(keyAtIndex(BASE_FIRST_ITEM_INDEX, ['a', 'b', 'c'], BASE_FIRST_ITEM_INDEX + 2)).toBe('c')
  })

  it('has nothing outside the run of rows', () => {
    expect(keyAtIndex(BASE_FIRST_ITEM_INDEX, ['a'], BASE_FIRST_ITEM_INDEX - 1)).toBeNull()
    expect(keyAtIndex(BASE_FIRST_ITEM_INDEX, ['a'], BASE_FIRST_ITEM_INDEX + 1)).toBeNull()
  })
})

describe('prepends', () => {
  it('counts only the rows added in front', () => {
    expect(countPrepended(['b', 'c'], ['a', 'b', 'c'])).toBe(1)
    expect(countPrepended(['b', 'c'], ['b', 'c', 'd'])).toBe(0)
    expect(countPrepended([], ['a'])).toBe(0)
  })

  it('moves the first index down by the number prepended', () => {
    expect(nextFirstItemIndex(100_000, ['b', 'c'], ['a', 'b', 'c'])).toBe(99_999)
  })

  it('treats the same rows in the same order as unchanged', () => {
    expect(sameKeys(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameKeys(['a', 'b'], ['a', 'b', 'c'])).toBe(false)
  })
})
