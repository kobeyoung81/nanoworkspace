// How tall the git panel's resizable regions may grow.
//
// Both bounds are a fraction of the window rather than a fixed pixel size, so
// they have to be recomputed when the window changes size: a phone turned from
// portrait to landscape kept the caps of the taller window, which left a list
// taller than its share of the screen. Taking the viewport height as a parameter
// is what keeps the rule pure — the panel reads the height through
// useViewportHeight and passes it in.

/** Smallest height a region may be dragged to; also the floor for its bound. */
export const DOCK_HEIGHT_MIN = 80
/** Smallest height the change list may be dragged to. */
export const CHANGE_HEIGHT_MIN = 80

/** Upper bound for a docked panel (never taller than 70% of the view). */
export function dockHeightMax(viewH: number): number {
  return Math.max(DOCK_HEIGHT_MIN + 40, Math.round(viewH * 0.7))
}

/** Upper bound for the change list: it never grows past 60% of the view. */
export function changeHeightMax(viewH: number): number {
  return Math.max(CHANGE_HEIGHT_MIN + 40, Math.round(viewH * 0.6))
}
