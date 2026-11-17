import type { DockId } from './types'

// Edge zone widths (as fractions of the workbench content rect) where a drag
// docks to that edge rather than entering the central cross area.
export const EDGE_LEFT = 0.2
export const EDGE_RIGHT = 0.8
export const EDGE_BOTTOM = 0.78
export const DOCK_FRACTION = { left: EDGE_LEFT, right: 1 - EDGE_RIGHT, bottom: 1 - EDGE_BOTTOM }

export type DropTarget =
  | { slot: 'left'; kind: 'edge' | 'cross' }
  | { slot: 'right'; kind: 'edge' | 'cross' }
  | { slot: 'bottom'; kind: 'edge' | 'cross' }
  | { slot: 'center'; kind: 'core' }

// resolveDropTarget maps a pointer position inside `rect` to a dock target. The
// zones replicate VS Code's behaviour: hovering the bottom band (full width)
// previews a bottom dock, the screen edges preview side docks, and the central
// area shows a 4-way cross where the hovered quadrant selects the result (or
// the core moves the panel as a center tab).
export function resolveDropTarget(x: number, y: number, rect: DOMRect): DropTarget | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }
  const rx = (x - rect.left) / rect.width
  const ry = (y - rect.top) / rect.height

  // Bottom band takes precedence across the full width so corners dock bottom.
  if (ry > EDGE_BOTTOM) {
    return { slot: 'bottom', kind: 'edge' }
  }
  if (rx < EDGE_LEFT) {
    return { slot: 'left', kind: 'edge' }
  }
  if (rx > EDGE_RIGHT) {
    return { slot: 'right', kind: 'edge' }
  }
  // Central cross area.
  if (rx > 0.4 && rx < 0.6 && ry > 0.3 && ry < 0.7) {
    return { slot: 'center', kind: 'core' }
  }
  if (ry > 0.5) {
    return { slot: 'bottom', kind: 'cross' }
  }
  return rx < 0.5 ? { slot: 'left', kind: 'cross' } : { slot: 'right', kind: 'cross' }
}

export type { DockId }