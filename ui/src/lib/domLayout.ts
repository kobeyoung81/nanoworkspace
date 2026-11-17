// Whether an element is actually laid out on screen.
//
// The workbench keeps every panel mounted: the ones it is not showing sit in a
// `display:none` vault or a hidden dock, so a component can be asked to measure
// itself while it has no box at all. Such a measurement is degenerate — zero
// height, zero scrollHeight — which is why both the code that reads those
// numbers and the code that answers a page-wide shortcut need this question
// answered the same way.

/** The slice of an element this module needs to tell whether it is on screen. */
export type VisibleCheck = { offsetParent: unknown; getClientRects: () => { length: number } }

/**
 * isLaidOut reports whether an element has a box. A detached or display:none
 * element reports no offsetParent and no client rects; an element positioned
 * fixed has no offsetParent either, which is what the rect check covers.
 */
export function isLaidOut(el: VisibleCheck | null | undefined): boolean {
  if (!el) {
    return false
  }
  if (el.offsetParent) {
    return true
  }
  return typeof el.getClientRects === 'function' && el.getClientRects().length > 0
}
