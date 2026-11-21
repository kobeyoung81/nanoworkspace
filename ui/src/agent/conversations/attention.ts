// Attention: which conversations are running and which are waiting for the user,
// and the union of that per agent.
//
// Two sources feed it. The portal's attention snapshot covers every conversation
// of the user's agents — the sidebar alone cannot see an agent whose list was
// never fetched, and the session list carries no "waiting" marker (it lives in
// the session's meta blob, which only a single-session read returns). The
// browser's own open tabs know better for the conversations they hold, because
// their socket streams, so their state wins for those.
//
// This module is pure so both rules — the union and "live wins" — are testable
// without a browser: it only turns the two sources into the dots a row renders.

import type { SessionSummary } from '../lib/api'
import { isUnread, unreadSinceBaseline } from '../lib/unread'
import type { ConversationTab, TabSummary } from './store'

/** One conversation's attention flags: waiting, running, and unread. */
export type Attention = { running: boolean; awaiting: boolean; unread: boolean }

/** What the browser last read, keyed like `attentionKey`, valued by the
 * conversation's server `updated_at` at that moment. */
export type ReadAt = Record<string, string>

/** One row of GET /api/user/v1/agents/attention. */
export type ConversationAttention = {
  agent_id: string
  chat_id: string
  session_id: string
  running: boolean
  awaiting: boolean
  /** Newest segment's server timestamp; "" when the row predates it. */
  updated_at: string
}

export type AttentionIndex = {
  /** Keyed by `attentionKey(agentId, chatId)`. */
  conversations: Record<string, Attention>
  /** The union of `conversations`, per agent id. */
  agents: Record<string, Attention>
}

const NONE: Attention = { running: false, awaiting: false, unread: false }
const SEPARATOR = '|'

/** The index key of one conversation. */
export function attentionKey(agentId: string, chatId: string): string {
  return `${agentId}${SEPARATOR}${chatId}`
}

function union(base: Attention | undefined, next: Attention): Attention {
  return {
    running: Boolean(base?.running || next.running),
    awaiting: Boolean(base?.awaiting || next.awaiting),
    unread: Boolean(base?.unread || next.unread),
  }
}

/**
 * The per-agent union, derived from the conversations themselves so it can never
 * disagree with the rows: an agent whose only dot came from a conversation that
 * has since been reported as finished must lose it too.
 */
function agentsFromConversations(conversations: Record<string, Attention>): Record<string, Attention> {
  const agents: Record<string, Attention> = {}
  for (const [key, attention] of Object.entries(conversations)) {
    const agentId = key.slice(0, key.lastIndexOf(SEPARATOR))
    agents[agentId] = union(agents[agentId], attention)
  }
  return agents
}

/**
 * Indexes the server snapshot by conversation and by agent.
 *
 * `readAt` is what this browser last read, so a conversation whose server
 * timestamp moved past it is unread. A missing entry means "never looked at",
 * which is treated as read: otherwise the first render of a fresh browser would
 * light up every historical conversation.
 */
export function indexAttention(
  rows: ConversationAttention[],
  readAt: ReadAt = {},
  baselineAt = '',
): AttentionIndex {
  const conversations: Record<string, Attention> = {}
  for (const row of rows) {
    const key = attentionKey(row.agent_id, row.chat_id)
    const seen = readAt[key]
    conversations[key] = {
      running: row.running,
      awaiting: row.awaiting,
      unread: seen
        ? isUnread(row.updated_at ?? '', seen)
        : unreadSinceBaseline(row.updated_at ?? '', baselineAt),
    }
  }
  return { conversations, agents: agentsFromConversations(conversations) }
}

/**
 * Overlays what this browser knows first-hand: the open conversations.
 *
 * A tab's state wins over the snapshot for its own conversation, including
 * "nothing is running" — the snapshot is up to one poll old, so letting it win
 * would keep a dot lit after the turn it describes had already finished. A tab
 * whose conversation has no chat id yet (the gateway has not named it) cannot be
 * keyed, so it only counts towards its agent.
 */
export function applyLiveAttention(
  index: AttentionIndex,
  tabs: ConversationTab[],
  summaries: Record<string, TabSummary>,
): AttentionIndex {
  if (tabs.length === 0) {
    return index
  }
  const conversations = { ...index.conversations }
  const unkeyed: Record<string, Attention> = {}
  for (const tab of tabs) {
    const summary = summaries[tab.id]
    // A tab that has not published a summary yet says nothing; falling back to
    // the snapshot is better than blinking its dot off.
    if (!summary) {
      continue
    }
    // The browser knows better than the snapshot only about *activity*: a turn
    // that has finished, or a question that is waiting. Unread is different — it
    // clears only while the conversation is actually being read, which an open
    // tab in the background is not.
    const known = tab.chatId ? index.conversations[attentionKey(tab.agentId, tab.chatId)] : undefined
    const live = {
      running: summary.busy,
      awaiting: summary.awaitingInput,
      unread: summary.reading ? false : Boolean(known?.unread),
    }
    if (tab.chatId) {
      conversations[attentionKey(tab.agentId, tab.chatId)] = live
    } else {
      unkeyed[tab.agentId] = union(unkeyed[tab.agentId], live)
    }
  }
  const agents = agentsFromConversations(conversations)
  for (const [agentId, attention] of Object.entries(unkeyed)) {
    agents[agentId] = union(agents[agentId], attention)
  }
  return { conversations, agents }
}

/**
 * The dots for one conversation row. Before the first snapshot lands, the row's
 * own turn flag is all there is to go on — and it says nothing about waiting,
 * which only a live conversation can report.
 */
export function sessionAttention(
  index: AttentionIndex,
  agentId: string | null,
  session: SessionSummary,
): Attention {
  const known = agentId ? index.conversations[attentionKey(agentId, session.chat_id)] : undefined
  return known ?? { running: Boolean(session.turn_running), awaiting: false, unread: false }
}

/** The dots for one agent row: everything known about its conversations. */
export function agentAttention(index: AttentionIndex, agentId: string): Attention {
  return index.agents[agentId] ?? NONE
}
