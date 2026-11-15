// Merge functions for the two pieces of state that two portal tabs in one
// browser both write: the workbench layout and the conversation tab group.
//
// They exist because a write used to be "put my whole snapshot back". With two
// tabs open, whichever wrote last silently reverted the other one's change —
// opening a conversation in one tab could make the other tab's newly opened one
// disappear. Given the freshly stored value, this tab's next value and the value
// this tab last read, a merge applies only *this* tab's changes to the stored
// value, so both survive.
//
// Pure functions on the stored payloads, so the interleavings are unit-tested
// instead of reproduced by hand in two browser tabs.

import { canonicalPanelId } from '../workbench/pluginIds'

/** Tab count ceiling, shared with the store (`MAX_TABS`). Each open tab keeps a
 * WebSocket and its transcript mounted, so the ceiling is a resource guard, not
 * a UX wall: it is high enough that a user never meets it. */
export const STORED_TABS_MAX = 20

export type StoredDock = { tabs: string[]; active: string | null }
export type StoredLayout = {
  v: 1
  /** The persisted name for the four docks. */
  slots: Record<string, StoredDock>
  sizes: { leftPct: number; rightPct: number; bottomPct: number }
  lastSlot: Record<string, string>
  hiddenSlots: Record<string, boolean>
}

export type StoredTab = {
  agentId: string
  sessionId: string | null
  chatId?: string | null
  agentName: string
  title?: string
  /**
   * The session the tab's socket was last named by the server: a fresh
   * conversation is named before any stored row exists, so the tab cannot bind
   * itself to that id, but it has to *remember* it — a stored group without it
   * comes back as a conversation with no history (see resolveResumeSession).
   * Optional: stored groups written before this field existed simply have none.
   */
  resumeSessionId?: string | null
}
export type StoredTabs = { v: 1; tabs: StoredTab[]; activeIndex: number }

const DOCK_IDS = ['left', 'center', 'right', 'bottom'] as const
const SIZE_KEYS = ['leftPct', 'rightPct', 'bottomPct'] as const

export function parseStoredLayout(raw: unknown): StoredLayout | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const value = raw as Partial<StoredLayout>
  const slots = value.slots ?? (value as { docks?: Record<string, StoredDock> }).docks
  if (value.v !== 1 || !slots || !value.sizes) {
    return null
  }
  const normalized: Record<string, StoredDock> = {}
  for (const dock of DOCK_IDS) {
    const stored = slots[dock]
    // Panel ids are canonicalized on read (see workbench/pluginIds): a renamed
    // plugin stays in the dock it was in, and the next write stores the new id.
    normalized[dock] = stored
      ? {
          tabs: Array.isArray(stored.tabs) ? stored.tabs.map(canonicalPanelId) : [],
          active: stored.active ? canonicalPanelId(stored.active) : null,
        }
      : { tabs: [], active: null }
  }
  const lastSlot: Record<string, string> = {}
  for (const [panelId, dock] of Object.entries(value.lastSlot ?? {})) {
    lastSlot[canonicalPanelId(panelId)] = dock
  }
  return {
    v: 1,
    slots: normalized,
    sizes: { ...value.sizes },
    lastSlot,
    hiddenSlots: { ...(value.hiddenSlots ?? {}) },
  }
}

export function parseStoredTabs(raw: unknown): StoredTabs | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const value = raw as Partial<StoredTabs>
  if (value.v !== 1 || !Array.isArray(value.tabs)) {
    return null
  }
  return {
    v: 1,
    tabs: value.tabs
      .filter(
        (tab): tab is StoredTab => Boolean(tab) && typeof tab.agentId === 'string' && tab.agentId !== '',
      )
      // A group written before the field existed has no resume id; normalising it
      // here keeps every reader from having to allow for a missing key.
      .map((tab) => ({
        ...tab,
        resumeSessionId: typeof tab.resumeSessionId === 'string' && tab.resumeSessionId !== '' ? tab.resumeSessionId : null,
      })),
    activeIndex: Number.isInteger(value.activeIndex) ? (value.activeIndex as number) : 0,
  }
}

function sameDock(a: StoredDock | undefined, b: StoredDock | undefined): boolean {
  if (!a || !b) {
    return a === b
  }
  return a.active === b.active && a.tabs.length === b.tabs.length && a.tabs.every((id, i) => id === b.tabs[i])
}

/**
 * Applies this tab's layout changes onto the stored layout.
 *
 * Compared field by field (each dock's tabs and active tag, each size, each
 * plugin's remembered dock, each hidden dock) so that a size drag here and a
 * plugin toggle there both survive.
 */
export function mergeLayout(
  fresh: StoredLayout | null,
  next: StoredLayout,
  previous: StoredLayout | null,
): StoredLayout {
  if (!fresh || !previous) {
    return next
  }
  const merged: StoredLayout = {
    v: 1,
    slots: { ...fresh.slots },
    sizes: { ...fresh.sizes },
    lastSlot: { ...fresh.lastSlot },
    hiddenSlots: { ...fresh.hiddenSlots },
  }
  for (const dock of DOCK_IDS) {
    if (!sameDock(next.slots[dock], previous.slots[dock])) {
      merged.slots[dock] = { tabs: [...next.slots[dock].tabs], active: next.slots[dock].active }
    }
  }
  for (const key of SIZE_KEYS) {
    if (next.sizes[key] !== previous.sizes[key]) {
      merged.sizes[key] = next.sizes[key]
    }
  }
  for (const [plugin, dock] of Object.entries(next.lastSlot)) {
    if (dock !== previous.lastSlot[plugin]) {
      merged.lastSlot[plugin] = dock
    }
  }
  for (const [dock, hidden] of Object.entries(next.hiddenSlots)) {
    if (hidden !== previous.hiddenSlots[dock]) {
      merged.hiddenSlots[dock] = hidden
    }
  }
  return merged
}

/** The conversation a tab belongs to; two tabs never share one. */
function identityOf(tab: StoredTab): string {
  return `${tab.agentId}|${tab.chatId ?? tab.sessionId ?? ''}`
}

function sameIdentity(tab: StoredTab, other: StoredTab | undefined): boolean {
  if (!other) {
    return false
  }
  return (
    tab.sessionId === other.sessionId &&
    (tab.chatId ?? null) === (other.chatId ?? null) &&
    (tab.resumeSessionId ?? null) === (other.resumeSessionId ?? null) &&
    (tab.title ?? '') === (other.title ?? '') &&
    tab.agentName === other.agentName
  )
}

/**
 * Applies this tab's tab-group changes onto the stored group.
 *
 * A tab this pane opened is added, a tab another pane opened is kept, a tab
 * closed by either pane stays closed (a pane that changed nothing about a tab
 * takes the stored group's word for it, which is what stops a stale snapshot
 * from resurrecting a tab the other pane just closed), and a tab whose
 * conversation identity another pane updated (a new segment id, a title that
 * arrived) takes the fresher identity while keeping this pane's position.
 */
export function mergeTabPayload(
  fresh: StoredTabs | null,
  next: StoredTabs,
  previous: StoredTabs | null,
): StoredTabs {
  if (!fresh) {
    return next
  }
  // No baseline (a store that never read anything) is not "nothing to merge
  // with": tabs the stored group holds are still kept.
  const previousById = new Map((previous?.tabs ?? []).map((tab) => [identityOf(tab), tab]))
  const freshById = new Map(fresh.tabs.map((tab) => [identityOf(tab), tab]))
  const nextIds = new Set(next.tabs.map(identityOf))
  const merged: StoredTab[] = []
  for (const tab of next.tabs) {
    const id = identityOf(tab)
    const previousTab = previousById.get(id)
    if (previousTab && !freshById.has(id)) {
      // Unchanged here, gone there: the other pane closed it.
      continue
    }
    const freshTab = freshById.get(id)
    if (!freshTab || (previousTab && sameIdentity(freshTab, previousTab))) {
      merged.push(tab)
      continue
    }
    merged.push({
      ...tab,
      sessionId: freshTab.sessionId,
      chatId: freshTab.chatId,
      title: freshTab.title,
      agentName: freshTab.agentName,
      // Whichever pane recorded a resume id has one that is at least as recent as
      // this pane's, and losing it is what costs a conversation its history.
      resumeSessionId: freshTab.resumeSessionId ?? tab.resumeSessionId ?? null,
    })
  }
  for (const tab of fresh.tabs) {
    const id = identityOf(tab)
    // Keep what this pane already lists, and keep what this pane closed.
    if (nextIds.has(id) || previousById.has(id)) {
      continue
    }
    merged.push(tab)
  }
  const tabs = merged.slice(0, STORED_TABS_MAX)
  const activeIndex =
    !previous || next.activeIndex !== previous.activeIndex ? next.activeIndex : fresh.activeIndex
  return { v: 1, tabs, activeIndex: Math.max(0, Math.min(activeIndex, tabs.length - 1)) }
}
