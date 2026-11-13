// Merged cells in a worksheet, clipped to the rows actually rendered.
//
// SheetJS reports merges as absolute ranges. A worksheet is trimmed to the first
// N rows before rendering, so a merge that crosses the cut has to shrink instead
// of pushing a rowSpan past the last rendered row.

export type CellRange = { s: { r: number; c: number }; e: { r: number; c: number } }

export type MergeLayout = {
  /** Anchor cell → spans to render. */
  spans: Map<string, { rowSpan: number; colSpan: number }>
  /** Cells hidden because their anchor is elsewhere. */
  covered: Set<string>
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`
}

export function mergeLayout(merges: readonly CellRange[], rowCount: number): MergeLayout {
  const spans = new Map<string, { rowSpan: number; colSpan: number }>()
  const covered = new Set<string>()

  for (const merge of merges) {
    const startRow = merge.s.r
    const startCol = merge.s.c
    const endRow = Math.min(merge.e.r, rowCount - 1)
    if (startRow < 0 || startRow > endRow) {
      continue
    }
    const colSpan = Math.max(1, merge.e.c - startCol + 1)
    spans.set(cellKey(startRow, startCol), { rowSpan: endRow - startRow + 1, colSpan })
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col < startCol + colSpan; col++) {
        if (row === startRow && col === startCol) {
          continue
        }
        covered.add(cellKey(row, col))
      }
    }
  }

  return { spans, covered }
}
