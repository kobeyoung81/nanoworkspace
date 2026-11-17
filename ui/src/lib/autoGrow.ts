// The height an auto-growing textarea should take.
//
// The obvious implementation — write `scrollHeight` into the element's inline
// height — has one trap: a textarea the workbench has mounted but not shown
// lives in a `display:none` vault (or a collapsed dock), where the browser lays
// out nothing and reports `scrollHeight === 0`. Writing that in as a height
// collapses the field to a sliver, and because the field is only re-measured
// when its value changes, it stays a sliver until someone types. The decision is
// therefore a pure function with an explicit "do not trust this measurement"
// outcome, which is what makes it testable without a DOM.

/** The inline height to apply, plus the overflow that goes with it. */
export type AutoGrow = { height: number | null; overflowY: 'auto' | 'hidden' }

/**
 * autoGrow decides the inline height for a measured textarea. `height: null`
 * means "drop the inline height and let CSS decide" (the field's own line count
 * and minimum), which is the answer for a hidden element and for any
 * measurement that came back degenerate. `measured` is never negative in
 * practice, but a non-finite or non-positive value can only come from a box the
 * browser did not lay out, so it is treated the same way.
 */
export function autoGrow(input: { laidOut: boolean; measured: number }, max: number): AutoGrow {
  if (!input.laidOut || !Number.isFinite(input.measured) || input.measured <= 0) {
    return { height: null, overflowY: 'hidden' }
  }
  return {
    height: Math.min(input.measured, max),
    overflowY: input.measured > max ? 'auto' : 'hidden',
  }
}
