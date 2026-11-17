import type { DockId, DockState, WorkbenchLayout } from './types'
import { readState, writeStateMerged } from '../lib/clientState'
import { mergeLayout, parseStoredLayout, type StoredLayout } from '../lib/clientStateMerge'

export const DOCK_MIN: Record<DockId, number> = { left: 10, center: 0, right: 10, bottom: 10 }
export const DOCK_MAX: Record<DockId, number> = { left: 60, center: 100, right: 60, bottom: 60 }

export const DEFAULT_SIZES = { leftPct: 18, rightPct: 26, bottomPct: 34 }

export function defaultLayout(): WorkbenchLayout {
  // A narrow viewport gets a single conversation and no right dock; the width is
  // only the seed, since the layout is persisted from then on.
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1024
  return {
    v: 1,
    docks: {
      left: { tabs: ['agents'], active: 'agents' },
      center: { tabs: ['chat'], active: 'chat' },
      right: wide ? { tabs: ['files'], active: 'files' } : { tabs: [], active: null },
      bottom: { tabs: [], active: null },
    },
    sizes: { ...DEFAULT_SIZES },
    lastSlot: {},
    hiddenSlots: {},
  }
}

/**
 * The persisted payload keeps the historical "slots" key for the docks so saved
 * layouts survive the internal SlotId -> DockId rename; only the in-memory shape
 * changed.
 */
function toStored(layout: WorkbenchLayout): StoredLayout {
  return {
    v: 1,
    slots: {
      left: { tabs: [...layout.docks.left.tabs], active: layout.docks.left.active },
      center: { tabs: [...layout.docks.center.tabs], active: layout.docks.center.active },
      right: { tabs: [...layout.docks.right.tabs], active: layout.docks.right.active },
      bottom: { tabs: [...layout.docks.bottom.tabs], active: layout.docks.bottom.active },
    },
    sizes: { ...layout.sizes },
    lastSlot: { ...layout.lastSlot },
    hiddenSlots: { ...layout.hiddenSlots },
  }
}

function fromStored(stored: StoredLayout): WorkbenchLayout {
  const dock = (id: DockId): DockState => stored.slots[id] ?? { tabs: [], active: null }
  // Only real docks survive: a stale plugin entry must not become an unknown slot.
  const lastSlot: Record<string, DockId> = {}
  for (const [plugin, target] of Object.entries(stored.lastSlot)) {
    if (target === 'left' || target === 'center' || target === 'right' || target === 'bottom') {
      lastSlot[plugin] = target
    }
  }
  return {
    v: 1,
    docks: { left: dock('left'), center: dock('center'), right: dock('right'), bottom: dock('bottom') },
    sizes: { ...DEFAULT_SIZES, ...stored.sizes },
    lastSlot,
    hiddenSlots: { ...stored.hiddenSlots },
  }
}

// The stored payload this tab last read or wrote. It is what makes the write a
// merge: the fields that differ from it are this tab's changes, and only those
// are applied to whatever is stored when the write happens.
let persisted: StoredLayout | null = null

export function loadLayout(): WorkbenchLayout {
  const stored = readState('layout', undefined, parseStoredLayout, null)
  persisted = stored
  return stored ? fromStored(stored) : defaultLayout()
}

export function saveLayout(layout: WorkbenchLayout): void {
  persisted = writeStateMerged('layout', undefined, toStored(layout), persisted, mergeLayout, parseStoredLayout)
}

export function findPanelDock(layout: WorkbenchLayout, panelId: string): DockId | null {
  for (const dock of Object.keys(layout.docks) as DockId[]) {
    if (layout.docks[dock].tabs.includes(panelId)) {
      return dock
    }
  }
  return null
}

function removeFromDock(dock: DockState, panelId: string): string | null {
  const next = dock.tabs.filter((id) => id !== panelId)
  dock.tabs = next
  if (dock.active === panelId) {
    dock.active = next[0] ?? null
  }
  return dock.active
}

// togglePlugin shows a hidden plugin (at its last dock, or its default dock) or
// hides an active plugin. A visible-but-inactive plugin is just activated.
export function togglePlugin(layout: WorkbenchLayout, panelId: string, defaults: Record<string, DockId>): DockId {
  const current = findPanelDock(layout, panelId)
  if (current) {
    const dock = layout.docks[current]
    if (dock.active === panelId) {
      removeFromDock(dock, panelId)
      return current
    }
    dock.active = panelId
    return current
  }
  const target = layout.lastSlot[panelId] ?? defaults[panelId]
  const dock = layout.docks[target]
  dock.tabs.push(panelId)
  dock.active = panelId
  layout.lastSlot[panelId] = target
  return target
}

// hidePlugin removes a plugin from its dock entirely (the activity bar can
// re-open it).
export function hidePlugin(layout: WorkbenchLayout, panelId: string): void {
  const current = findPanelDock(layout, panelId)
  if (current) {
    removeFromDock(layout.docks[current], panelId)
  }
}

// movePlugin relocates a plugin into another dock. Returns whether the dock
// changed (used to skip redundant work). When insertIndex is provided the
// plugin is placed before that tag index, otherwise appended.
export function movePlugin(layout: WorkbenchLayout, panelId: string, toDock: DockId, insertIndex?: number): boolean {
  const current = findPanelDock(layout, panelId)
  const target = layout.docks[toDock]

  if (current === toDock) {
    target.active = panelId
    layout.lastSlot[panelId] = toDock
    return false
  }

  if (current) {
    removeFromDock(layout.docks[current], panelId)
  }

  const at = insertIndex !== undefined && insertIndex >= 0 && insertIndex <= target.tabs.length ? insertIndex : target.tabs.length
  target.tabs.splice(at, 0, panelId)
  target.active = panelId
  layout.lastSlot[panelId] = toDock
  return true
}

export function setDockSize(sizes: WorkbenchLayout['sizes'], dock: DockId, pct: number): void {
  const min = DOCK_MIN[dock]
  const max = DOCK_MAX[dock]
  const clamped = Math.min(max, Math.max(min, pct))
  if (dock === 'left') sizes.leftPct = clamped
  else if (dock === 'right') sizes.rightPct = clamped
  else if (dock === 'bottom') sizes.bottomPct = clamped
}

export function copyLayout(layout: WorkbenchLayout): WorkbenchLayout {
  return {
    v: 1,
    docks: {
      left: { tabs: [...layout.docks.left.tabs], active: layout.docks.left.active },
      center: { tabs: [...layout.docks.center.tabs], active: layout.docks.center.active },
      right: { tabs: [...layout.docks.right.tabs], active: layout.docks.right.active },
      bottom: { tabs: [...layout.docks.bottom.tabs], active: layout.docks.bottom.active },
    },
    sizes: { ...layout.sizes },
    lastSlot: { ...layout.lastSlot },
    hiddenSlots: { ...layout.hiddenSlots },
  }
}