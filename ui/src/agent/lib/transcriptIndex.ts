// The virtual index space of the transcript.
//
// react-virtuoso maps its `data` array onto a contiguous run of virtual indices,
// the first of which is `firstItemIndex`. Older history is prepended to the
// *front* of that array, which would renumber every row already on screen — and
// the library keeps the viewport by index, so the reader's position would move
// with the renumbering. Letting the first index follow the number of prepended
// rows is what makes a prepend invisible (the library's "prepend items" recipe,
// and the reason this is a separate, testable step rather than an inline count).

/** Where the index space starts. Only the distance below it is ever used. */
export const BASE_FIRST_ITEM_INDEX = 100_000

/** Whether two key lists are the same rows in the same order. */
export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/**
 * How many rows were added in front of everything that was already there.
 *
 * The list only ever grows at the front (older history) and at the back (the
 * newest message, and the blocks a streaming turn opens), so the prepended rows
 * are exactly the leading keys the previous list did not have. A first list is
 * the baseline rather than a prepend of everything.
 */
export function countPrepended(previous: readonly string[], keys: readonly string[]): number {
  if (previous.length === 0) {
    return 0
  }
  const known = new Set(previous)
  let count = 0
  for (const key of keys) {
    if (known.has(key)) {
      break
    }
    count += 1
  }
  return count
}

/** The first virtual index for a key list, given the previous list and its own. */
export function nextFirstItemIndex(
  first: number,
  previous: readonly string[],
  keys: readonly string[],
): number {
  return first - countPrepended(previous, keys)
}

/**
 * The row's offset inside the data array, or null when it is not in the list.
 *
 * react-virtuoso reads `initialTopMostItemIndex` and `scrollToIndex` in this
 * space: the count it clamps against is the data length, and the library adds
 * `firstItemIndex` itself when it turns the row into a virtual index. Handing it
 * the virtual index (100000 + n) therefore clamps to the *last* row — which is
 * how a remembered row silently turned into "the newest message".
 */
export function positionOfKey(keys: readonly string[], key: string): number | null {
  const position = keys.indexOf(key)
  return position < 0 ? null : position
}

/** The row at a virtual index, or null when the index is outside the list. */
export function keyAtIndex(first: number, keys: readonly string[], index: number): string | null {
  const position = index - first
  return position < 0 || position >= keys.length ? null : keys[position]
}
