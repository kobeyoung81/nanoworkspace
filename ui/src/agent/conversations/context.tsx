/* eslint-disable react-refresh/only-export-components */
// Context modules export providers alongside hooks by design; the fast-refresh
// boundary concern does not apply to this module.
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { useMemo } from 'react'
import { EMPTY_SUMMARY, type ConversationsState, type ConversationsStore, type TabSummary } from './store'
import type { SessionLists } from './sessionLists'
import type { LoadedSegment } from '../hooks/useAgent'
import type { SessionMetaSnapshot } from '../lib/sessionMeta'

// ConversationsContext gives the conversation runtime (one component per tab)
// the shared pieces it needs without threading props through the workbench.
export type ConversationsContextValue = {
  store: ConversationsStore
  token: string
  /** Reads one stored conversation segment (one agent_sessions row) whole. */
  loadSegment: (sessionId: string, etag?: string) => Promise<LoadedSegment>
  /** Refreshes one agent's conversation-list bucket (see sessionLists.ts). */
  loadSessionList: (agentId: string, opts?: { force?: boolean }) => void
  /** Every agent's conversation list: a tab reads the bucket of its own agent. */
  sessionLists: SessionLists
  /** Metadata-only read, used to reconcile a finished turn without the row. */
  loadSessionMeta: (sessionId: string) => Promise<SessionMetaSnapshot>
  /**
   * Re-reads the attention snapshot (which conversations run / wait for the
   * user). Called when a turn starts or finishes so the sidebar's dots follow
   * the browser's own conversation without waiting for the poll.
   */
  refreshAttention: () => void
  /** Records the conversation a socket is running (fresh chats, splits). */
  onSessionResolved: (agentId: string, sessionId: string | null) => void
}

const ConversationsCtx = createContext<ConversationsContextValue | null>(null)

export function ConversationsProvider({ value, children }: { value: ConversationsContextValue; children: ReactNode }) {
  return <ConversationsCtx.Provider value={value}>{children}</ConversationsCtx.Provider>
}

export function useConversations(): ConversationsContextValue {
  const value = useContext(ConversationsCtx)
  if (!value) {
    throw new Error('useConversations must be used inside ConversationsProvider')
  }
  return value
}

/** Subscribes to the tab group (open/active/summaries). */
export function useConversationsState(): ConversationsState {
  const { store } = useConversations()
  return useSyncExternalStore(store.subscribe, store.getState)
}

/** The summary of the active conversation, for the chrome that lives outside
 * the tab bodies (dock header, status bar). Falls back to the empty summary so
 * the chrome renders while tabs are still opening. */
export type ActiveConversation = {
  id: string | null
  agentId: string | null
  agentName: string | null
  title?: string
  summary: TabSummary
}

export function useActiveConversation(): ActiveConversation {
  const state = useConversationsState()
  return useMemo(() => {
    const tab = state.tabs.find((item) => item.id === state.activeId)
    return {
      id: tab?.id ?? null,
      agentId: tab?.agentId ?? null,
      agentName: tab?.agentName ?? null,
      title: tab?.title,
      summary: (tab && state.summaries[tab.id]) || EMPTY_SUMMARY,
    }
  }, [state])
}
