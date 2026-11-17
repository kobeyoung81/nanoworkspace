// Mirrors the hook's ContextUsage shape. Declared here rather than imported so
// this module compiles (and is testable) on its own, with no React dependency.
export type ContextUsage = { used: number; limit: number; pct: number; budget?: number; threshold?: number }

// Conversation tabs: one tab is one conversation (an agent plus a session), and
// the store below owns which conversations are open, which one is active and
// what the UI needs to know about the ones running in the background.
//
// Everything here is pure state handling: no React, no network, no DOM. The UI
// subscribes with useSyncExternalStore and the runtime components (one per tab)
// publish their summary back in. That keeps the tricky part — reuse, the tab
// cap, eviction, persistence — testable without a browser.
//
// Persistence goes through the client-state module, which namespaces the key by
// the signed-in account and merges the write into whatever another portal tab
// stored in the meantime.

import { readState, writeStateMerged } from '../lib/clientState'
import { recordDiag } from '../lib/debug'
import { mergeTabPayload, parseStoredTabs, STORED_TABS_MAX, type StoredTabs } from '../lib/clientStateMerge'

export type ConversationTab = {
  /** Client-side identity; stable for the lifetime of the tab. */
  id: string
  agentId: string
  /** null until the server names the conversation (a fresh chat). */
  sessionId: string | null
  /**
   * The session the socket was last named by the server. Never what the pane
   * binds to while it is alive (that would re-read a segment a fresh
   * conversation does not have yet) — it is what the *next* mount resumes, so a
   * reload comes back to this conversation instead of starting a new one.
   */
  resumeSessionId: string | null
  /**
   * The conversation this tab belongs to, without the segment version: a
   * compaction or /new moves the session id to ":vN+1" while the conversation
   * stays the same. Tabs are matched on this key so one conversation can never
   * end up with two tabs (and so a tab still finds its row after a split).
   */
  chatId: string | null
  /** Agent display name, kept here so the header renders without the agents list. */
  agentName: string
  title?: string
  openedAt: number
  /** Updated on every activation; the eviction order follows it. */
  lastActiveAt: number
}

/** The background-visible facts about a tab. Deliberately low-frequency: the
 * message arrays stay inside each tab's own runtime. */
export type TabSummary = {
  busy: boolean
  connected: boolean
  reconnecting: boolean
  error: string | null
  awaitingInput: boolean
  contextUsage: ContextUsage | null
  /**
   * Whether anything has entered this tab's transcript yet. A tab keeps no
   * session id after a turn either (binding it would rebind the socket and
   * re-read the running segment), so "no session id" alone cannot tell an
   * untouched new conversation from one that already shows a conversation —
   * this is what makes the difference, and only the untouched one may be taken
   * over by another conversation.
   */
  started: boolean
}

export type ConversationsState = {
  tabs: ConversationTab[]
  activeId: string | null
  summaries: Record<string, TabSummary>
}

export const EMPTY_SUMMARY: TabSummary = {
  busy: false,
  connected: false,
  reconnecting: false,
  error: null,
  awaitingInput: false,
  contextUsage: null,
  started: false,
}

/**
 * The new-conversation tab another conversation may take over: one for this agent
 * that the user has put nothing into yet. `started` is what makes "nothing"
 * knowable — a tab keeps no session id after a turn either, so an id-less tab
 * that already shows a conversation is not untouched and must be left alone.
 * Prefers the tab the user is looking at.
 */
export function unusedFreshTabId(
  tabs: ConversationTab[],
  summaries: Record<string, TabSummary>,
  activeId: string | null,
  agentId: string,
): string | null {
  const unused = tabs.filter((tab) => {
    if (tab.agentId !== agentId || tab.sessionId !== null) {
      return false
    }
    const summary = summaries[tab.id]
    return !summary?.busy && !summary?.awaitingInput && !summary?.started
  })
  if (unused.length === 0) {
    return null
  }
  return (unused.find((tab) => tab.id === activeId) ?? unused[unused.length - 1]).id
}

/**
 * How many conversations can stay open at once. Each tab keeps a connection and
 * its transcript mounted, so this is a resource guard rather than a UX wall
 * (LRU eviction always skips a tab that is working or waiting for the user).
 */
export const MAX_TABS = STORED_TABS_MAX

const EMPTY_STATE: ConversationsState = { tabs: [], activeId: null, summaries: {} }

/** The conversation key of a session id: `web:<chat>:v3` -> `<chat>`. */
export function conversationKeyOf(sessionId: string | null): string | null {
  if (!sessionId) {
    return null
  }
  return sessionId.replace(/^web:/, '').replace(/:v\d+$/, '')
}

function segmentVersion(sessionId: string | null): number {
  const match = /:v(\d+)$/.exec(sessionId ?? '')
  return match ? Number(match[1]) : 0
}

/**
 * Picks the segment a tab should point at. Callers that matched on the
 * conversation key may carry a stale remembered id; keeping the higher segment
 * version stops that from pulling a tab back to an archived segment.
 */
export function newerSessionId(current: string | null, incoming: string | null): string | null {
  if (!incoming) {
    return current
  }
  if (!current || current === incoming) {
    return incoming
  }
  const currentVersion = segmentVersion(current)
  const incomingVersion = segmentVersion(incoming)
  if (currentVersion !== incomingVersion) {
    return currentVersion > incomingVersion ? current : incoming
  }
  return incoming
}

export type OpenInput = {
  agentId: string
  sessionId: string | null
  agentName: string
  title?: string
  /**
   * A new-conversation tab the caller has decided the user has not used (see
   * unusedFreshTabId). Opening a conversation takes that tab over instead of
   * leaving it empty behind the user and adding another one. The caller decides
   * because it is the one holding the session list and the tab summaries.
   */
  adoptTabId?: string | null
}

export type OpenResult =
  | { ok: true; id: string; reused: boolean }
  | { ok: false; reason: 'at-capacity' }

export type ConversationsStore = {
  getState: () => ConversationsState
  subscribe: (listener: () => void) => () => void
  open: (input: OpenInput) => OpenResult
  activate: (id: string) => void
  /**
   * Closes a tab, activating its neighbour when it was the active one.
   *
   * `activateAgent` narrows that hand-over to one agent. Closing a conversation
   * on the user's behalf (a delete, a conversation the server no longer knows)
   * must never move the panel to another agent: the sidebar and every panel keyed
   * on the selected agent follow the active tab, so a neighbour from another
   * agent drags files, git and the terminal along with it. Without the option the
   * search stays global — closing a tab by hand keeps the old behaviour.
   */
  close: (id: string, options?: { activateAgent?: string }) => void
  setSession: (id: string, sessionId: string | null) => void
  /**
   * Records the session the pane's socket is running, without binding the tab to
   * it: the tab's `sessionId` is what the socket follows, and writing it here
   * would tear that socket down (and, for a conversation whose first row the
   * agent has not written yet, make the tab read a segment that does not exist).
   */
  setResumeSession: (id: string, sessionId: string | null) => void
  /**
   * Records which conversation a tab belongs to without binding it to a session
   * id. A fresh conversation is named by the server before any stored row exists,
   * so binding the tab to that id would make it re-read a segment that is not
   * there yet; knowing the conversation key is all the sidebar needs to match the
   * row back to this tab.
   */
  setChatId: (id: string, chatId: string | null) => void
  setTitle: (id: string, title: string) => void
  publishSummary: (id: string, summary: TabSummary) => void
  hasTabForSession: (agentId: string, sessionId: string | null) => boolean
  idsForSession: (sessionId: string) => string[]
  /** Every tab of one conversation, whatever segment it is parked on. */
  idsForConversation: (agentId: string, chatId: string | null) => string[]
}

/**
 * The tab to keep when one conversation ends up open more than once: prefer one
 * that is working or waiting for the user (closing it would throw away a
 * running turn or an unanswered prompt), then the most recently activated one.
 */
function pickPrimary(tabs: ConversationTab[], summaryOf: (id: string) => TabSummary): ConversationTab | null {
  if (tabs.length === 0) {
    return null
  }
  const holds = (tab: ConversationTab) => {
    const summary = summaryOf(tab.id)
    return summary.busy || summary.awaitingInput ? 1 : 0
  }
  return [...tabs].sort((a, b) => {
    const holdA = holds(a)
    const holdB = holds(b)
    if (holdA !== holdB) {
      return holdB - holdA
    }
    return b.lastActiveAt - a.lastActiveAt
  })[0]
}

let tabCounter = 0

function nextTabId(): string {
  tabCounter += 1
  return `conv-${tabCounter}-${Date.now()}`
}

function sameSummary(a: TabSummary, b: TabSummary): boolean {
  return (
    a.busy === b.busy &&
    a.connected === b.connected &&
    a.reconnecting === b.reconnecting &&
    a.error === b.error &&
    a.awaitingInput === b.awaitingInput &&
    a.contextUsage === b.contextUsage &&
    a.started === b.started
  )
}

/**
 * The stored payload is the wire shape of the tab group (no per-tab ids); the
 * in-memory state adds an id and the activation timestamps.
 */
function payloadToState(payload: StoredTabs | null): ConversationsState {
  if (!payload) {
    return EMPTY_STATE
  }
  const now = Date.now()
  const tabs: ConversationTab[] = payload.tabs
    .slice(0, MAX_TABS)
    .map((tab, index) => ({
      id: nextTabId(),
      agentId: tab.agentId,
      sessionId: tab.sessionId ?? null,
      resumeSessionId: tab.resumeSessionId ?? null,
      chatId: tab.chatId ?? conversationKeyOf(tab.sessionId ?? null),
      agentName: tab.agentName || tab.agentId,
      title: tab.title,
      openedAt: now + index,
      lastActiveAt: now + index,
    }))
  const activeIndex = Number.isInteger(payload.activeIndex) ? payload.activeIndex : 0
  return {
    tabs,
    activeId: tabs[activeIndex]?.id ?? tabs[0]?.id ?? null,
    summaries: {},
  }
}

function stateToPayload(state: ConversationsState): StoredTabs {
  return {
    v: 1,
    tabs: state.tabs.map((tab) => ({
      agentId: tab.agentId,
      sessionId: tab.sessionId,
      resumeSessionId: tab.resumeSessionId,
      chatId: tab.chatId,
      agentName: tab.agentName,
      title: tab.title,
    })),
    activeIndex: Math.max(0, state.tabs.findIndex((tab) => tab.id === state.activeId)),
  }
}

/**
 * The tab to activate once the one at `index` is closed: the nearest one on its
 * left first, then on its right, so the eye stays put. `agentId` limits the
 * search to that agent; it can leave nothing to activate, which the caller shows
 * as an empty panel rather than as somebody else's conversation.
 *
 * `tabs` is the group *after* the removal, so `index` is the position the closed
 * tab held and `index - 1` is already its left neighbour.
 */
function nextActiveAfterClose(tabs: ConversationTab[], index: number, agentId?: string): string | null {
  const allowed = (tab: ConversationTab) => !agentId || tab.agentId === agentId
  for (let i = index - 1; i >= 0; i--) {
    if (allowed(tabs[i])) {
      return tabs[i].id
    }
  }
  for (let i = index; i < tabs.length; i++) {
    if (allowed(tabs[i])) {
      return tabs[i].id
    }
  }
  return null
}

export function createConversationsStore(options?: { persist?: boolean }): ConversationsStore {
  const persist = options?.persist ?? true
  // The payload this store last read or wrote: the diff against it is what is
  // merged into the stored group, so a second portal tab cannot be reverted.
  let storedPayload = persist ? readState('tabs', undefined, parseStoredTabs, null) : null
  let state = persist ? payloadToState(storedPayload) : { ...EMPTY_STATE }
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  // Written synchronously: the tab group is about a kilobyte, and it has to
  // survive an immediate reload (the debounce is on the much larger list
  // snapshot instead, see AgentPage.schedulePersist).
  const save = () => {
    if (!persist) {
      return
    }
    storedPayload = writeStateMerged(
      'tabs',
      undefined,
      stateToPayload(state),
      storedPayload,
      mergeTabPayload,
      parseStoredTabs,
    )
  }

  const set = (next: ConversationsState, write = true) => {
    state = next
    if (write) {
      save()
    }
    emit()
  }

  const summaryOf = (id: string): TabSummary => state.summaries[id] ?? EMPTY_SUMMARY

  const evictableId = (): string | null => {
    // Never drop a tab that is working or waiting for the user: they would lose
    // a running turn or an unanswered question. Oldest activation first.
    const candidates = state.tabs
      .filter((tab) => tab.id !== state.activeId)
      .filter((tab) => {
        const summary = summaryOf(tab.id)
        return !summary.busy && !summary.awaitingInput
      })
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    return candidates[0]?.id ?? null
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    open: (input) => {
      const chatId = conversationKeyOf(input.sessionId)
      // A tab is matched by conversation identity, never by "both are empty":
      //  * naming a conversation matches the tab holding the same conversation
      //    key, whatever segment it is parked on, so a compaction cannot open a
      //    second tab for the same conversation;
      //  * a fresh conversation only matches a tab that is itself still
      //    unassigned — otherwise "+ new" would hijack a live conversation whose
      //    tab has not learned its session id yet.
      const matches = chatId
        ? state.tabs.filter((tab) => tab.agentId === input.agentId && tab.chatId === chatId)
        : state.tabs.filter((tab) => tab.agentId === input.agentId && tab.sessionId === null && tab.chatId === null)
      // Nothing holds this conversation yet, but an untouched new-conversation tab
      // may be sitting in front of the user: take it over rather than leave it
      // behind. The guard is repeated here so a caller cannot hand over a tab that
      // has since started working.
      const adoptable =
        input.adoptTabId === undefined || input.adoptTabId === null
          ? undefined
          : state.tabs.find(
              (tab) =>
                tab.id === input.adoptTabId &&
                tab.agentId === input.agentId &&
                tab.sessionId === null &&
                !summaryOf(tab.id).busy &&
                !summaryOf(tab.id).awaitingInput,
            )
      const primary = pickPrimary(matches, summaryOf) ?? adoptable
      if (primary) {
        // Collapse duplicates: one conversation must not occupy several tabs.
        const dropped = new Set(matches.filter((tab) => tab.id !== primary.id).map((tab) => tab.id))
        const tabs = state.tabs
          .filter((tab) => !dropped.has(tab.id))
          .map((tab) => {
            if (tab.id !== primary.id) {
              return tab
            }
            const summary = summaryOf(tab.id)
            const midTurn = summary.busy || summary.awaitingInput
            return {
              ...tab,
              // A tab that is already working on this conversation keeps its own
              // session id: re-pointing it would tear the socket down and re-read
              // the segment underneath a running turn.
              sessionId: midTurn && chatId ? tab.sessionId : newerSessionId(tab.sessionId, input.sessionId),
              chatId: chatId ?? tab.chatId,
              lastActiveAt: Date.now(),
            }
          })
        const summaries = { ...state.summaries }
        for (const id of dropped) {
          delete summaries[id]
        }
        set({ ...state, tabs, summaries, activeId: primary.id })
        return { ok: true, id: primary.id, reused: true }
      }
      if (state.tabs.length >= MAX_TABS) {
        const victim = evictableId()
        if (!victim) {
          return { ok: false, reason: 'at-capacity' }
        }
        const remaining = state.tabs.filter((tab) => tab.id !== victim)
        const summaries = { ...state.summaries }
        delete summaries[victim]
        state = { ...state, tabs: remaining, summaries }
      }
      const now = Date.now()
      const tab: ConversationTab = {
        id: nextTabId(),
        agentId: input.agentId,
        sessionId: input.sessionId,
        resumeSessionId: input.sessionId,
        chatId,
        agentName: input.agentName,
        title: input.title,
        openedAt: now,
        lastActiveAt: now,
      }
      set({ ...state, tabs: [...state.tabs, tab], activeId: tab.id })
      return { ok: true, id: tab.id, reused: false }
    },

    activate: (id) => {
      const tab = state.tabs.find((item) => item.id === id)
      if (!tab || state.activeId === id) {
        return
      }
      set({
        ...state,
        activeId: id,
        tabs: state.tabs.map((item) => (item.id === id ? { ...item, lastActiveAt: Date.now() } : item)),
      })
    },

    close: (id, options) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index < 0) {
        return
      }
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const summaries = { ...state.summaries }
      delete summaries[id]
      let activeId = state.activeId
      if (activeId === id) {
        activeId = nextActiveAfterClose(tabs, index, options?.activateAgent)
      }
      set({ tabs, activeId, summaries })
    },

    setSession: (id, sessionId) => {
      const chatId = conversationKeyOf(sessionId)
      // Clearing the session clears what would be resumed too: the tab has just
      // decided this conversation is not there, and a forgotten id would send the
      // next mount straight back to what the server rejected.
      const resumeSessionId = sessionId === null ? null : undefined
      if (
        !state.tabs.some(
          (tab) =>
            tab.id === id &&
            (tab.sessionId !== sessionId || tab.chatId !== chatId || (sessionId === null && tab.resumeSessionId !== null)),
        )
      ) {
        return
      }
      const before = state.tabs.find((tab) => tab.id === id)
      recordDiag('tab.setSession', {
        tab: id,
        from: before?.sessionId ?? '(none)',
        to: sessionId ?? '(none)',
      })
      set({
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === id
            ? { ...tab, sessionId, chatId, resumeSessionId: resumeSessionId === null ? null : tab.resumeSessionId }
            : tab,
        ),
      })
    },

    setResumeSession: (id, sessionId) => {
      if (!sessionId || !state.tabs.some((tab) => tab.id === id && tab.resumeSessionId !== sessionId)) {
        return
      }
      recordDiag('tab.setResumeSession', {
        tab: id,
        from: state.tabs.find((tab) => tab.id === id)?.resumeSessionId ?? '(none)',
        to: sessionId,
      })
      set({
        ...state,
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, resumeSessionId: sessionId } : tab)),
      })
    },

    setChatId: (id, chatId) => {
      if (!chatId || !state.tabs.some((tab) => tab.id === id && tab.chatId !== chatId)) {
        return
      }
      recordDiag('tab.setChatId', {
        tab: id,
        from: state.tabs.find((tab) => tab.id === id)?.chatId ?? '(none)',
        to: chatId,
      })
      set({
        ...state,
        tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, chatId } : tab)),
      })
    },

    setTitle: (id, title) => {
      if (!title || !state.tabs.some((tab) => tab.id === id && tab.title !== title)) {
        return
      }
      set({ ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)) })
    },

    publishSummary: (id, summary) => {
      // Summaries are not persisted, so this never writes storage — and it is
      // the only path that runs on every turn.
      if (sameSummary(summaryOf(id), summary)) {
        return
      }
      set({ ...state, summaries: { ...state.summaries, [id]: summary } }, false)
    },

    hasTabForSession: (agentId, sessionId) =>
      state.tabs.some((tab) => tab.agentId === agentId && tab.sessionId === sessionId),

    idsForSession: (sessionId) =>
      sessionId ? state.tabs.filter((tab) => tab.sessionId === sessionId).map((tab) => tab.id) : [],

    idsForConversation: (agentId, chatId) =>
      chatId
        ? state.tabs.filter((tab) => tab.agentId === agentId && tab.chatId === chatId).map((tab) => tab.id)
        : [],
  }
}
