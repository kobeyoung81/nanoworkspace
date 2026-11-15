/** Direction a resize handle grows the panel it belongs to. */
export type ResizeGrow = 'up' | 'down'

/**
 * Height reported by a drag. `up` grows the panel when the pointer moves up,
 * which is right for a handle on a panel's bottom edge in a column that fills
 * upward; `down` grows it when the pointer moves down, which is right for a
 * handle on a panel's top edge, like the docked history/tags/stashes panels.
 */
export function heightFromDrag(grow: ResizeGrow, startValue: number, startY: number, moveY: number): number {
  return grow === 'down' ? startValue + (moveY - startY) : startValue + (startY - moveY)
}

/** Height reported by an arrow key, mirroring the drag direction. */
export function heightFromKey(
  grow: ResizeGrow,
  value: number,
  key: 'ArrowUp' | 'ArrowDown',
  step = 16,
): number {
  const away = key === 'ArrowDown' ? -1 : 1
  return value + (grow === 'down' ? -away : away) * step
}
