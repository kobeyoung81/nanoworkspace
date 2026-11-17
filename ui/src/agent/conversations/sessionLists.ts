// Per-agent conversation lists.
//
// Every agent owns a bucket and only ever writes its own: the sidebar renders
// the selected agent's bucket, and a tab reads the bucket of the agent it
// belongs to (that is where its title comes from). A background conversation's
// refresh therefore cannot leak a row into another agent's list — which is what
// used to make the sidebar show a conversation of a different agent.

import type { SessionSummary } from '../lib/api'
import { conversationKeyOf } from './store'

/** One agent's conversation list plus the flags the sidebar renders. */
export type SessionListEntry = {
  /** Grouped rows, ready to render (see groupSessions). */
  rows: SessionSummary[]
  /**
   * Every row the server returned for this agent, ungrouped — including the
   * archived segments that `rows` folds away. It is what lets the transcript
   * infer the segment chain when a row does not record its predecessor
   * (see previousSegmentFallback).
   */
  segments: SessionSummary[]
  /** How many rows the server holds, for stopping paging. */
  total: number
  /** When the newest page was fetched; 0 means "needs revalidating". */
  fetchedAt: number
  /**
   * Server rows consumed so far: the offset for the next page. The server pages
   * over raw `agent_sessions` rows while `rows` is grouped and filtered, so the
   * visible count can never be used as an offset.
   */
  rawOffset: number
  /** The server said there are rows beyond rawOffset. */
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  error: string | null
}

export type SessionLists = Record<string, SessionListEntry>

// A bucket younger than this is not fetched again, so clicking back and forth
// between agents issues no request at all.
export const SESSION_LIST_FRESH_MS = 15_000

export const EMPTY_ENTRY: SessionListEntry = {
  rows: [],
  segments: [],
  total: 0,
  fetchedAt: 0,
  rawOffset: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
  error: null,
}

export function entryFor(lists: SessionLists, agentId: string | null): SessionListEntry {
  if (!agentId) {
    return EMPTY_ENTRY
  }
  return lists[agentId] ?? EMPTY_ENTRY
}

export function isFresh(entry: SessionListEntry, now: number, freshMs: number = SESSION_LIST_FRESH_MS): boolean {
  return entry.fetchedAt > 0 && now - entry.fetchedAt < freshMs
}

/**
 * Only the newest request for an agent may write its bucket: a response that
 * was already in flight when a newer one started must be dropped.
 */
export function mayApply(gen: number, latestGen: number): boolean {
  return gen === latestGen
}

export function withEntry(lists: SessionLists, agentId: string, entry: SessionListEntry): SessionLists {
  return { ...lists, [agentId]: entry }
}

export function withoutAgent(lists: SessionLists, agentId: string): SessionLists {
  if (!(agentId in lists)) {
    return lists
  }
  const next = { ...lists }
  delete next[agentId]
  return next
}

/**
 * A stored snapshot is only good enough to paint: its buckets come back as
 * "needs revalidating" so the page fetches them again right away.
 */
export function restoredFromSnapshot(lists: SessionLists): SessionLists {
  const next: SessionLists = {}
  for (const [agentId, entry] of Object.entries(lists)) {
    // Every field is filled in explicitly. A snapshot is written by an older
    // version of this app, so it may predate any field added since; copying it
    // verbatim would leave the bucket missing that field, and a missing array is
    // not an empty list — it makes the next fetch throw before it can repair the
    // bucket, which is a permanent error rather than a slow one.
    next[agentId] = {
      rows: entry.rows ?? [],
      segments: entry.segments ?? [],
      total: entry.total ?? 0,
      fetchedAt: 0,
      rawOffset: entry.rawOffset ?? 0,
      hasMore: entry.hasMore ?? false,
      loading: false,
      loadingMore: false,
      error: null,
    }
  }
  return next
}

/**
 * The part of the buckets worth storing: rows, and the cursors that describe how
 * far paging has got. The transient flags are dropped so a write can never
 * restore a "loading" state after a reload.
 */
export function persistableLists(lists: SessionLists): SessionLists {
  const next: SessionLists = {}
  for (const [agentId, entry] of Object.entries(lists)) {
    next[agentId] = {
      rows: entry.rows ?? [],
      segments: entry.segments ?? [],
      total: entry.total ?? 0,
      fetchedAt: entry.fetchedAt,
      rawOffset: entry.rawOffset,
      hasMore: entry.hasMore,
      loading: false,
      loadingMore: false,
      error: null,
    }
  }
  return next
}

export function groupSessions(sessions: SessionSummary[]): SessionSummary[] {
  const web = sessions.filter((session) => session.channel === 'web' && session.status !== 'archived')
  const byConversation = new Map<string, SessionSummary>()
  for (const session of web) {
    const existing = byConversation.get(session.chat_id)
    if (!existing || session.updated_at >= existing.updated_at) {
      byConversation.set(session.chat_id, session)
    }
  }
  return [...byConversation.values()].sort(compareSessionRows)
}

/**
 * Newest first, with the row id as a tiebreak.
 *
 * `updated_at` has second resolution, so a busy agent produces rows that share
 * a timestamp. The old comparator returned -1 for equal rows (never 0), which
 * makes the sort inconsistent and let the visible order change on every
 * re-sort; the id tiebreak makes it deterministic instead.
 */
export function compareSessionRows(a: SessionSummary, b: SessionSummary): number {
  if (a.updated_at !== b.updated_at) {
    return a.updated_at < b.updated_at ? 1 : -1
  }
  if (a.id === b.id) {
    return 0
  }
  return a.id < b.id ? 1 : -1
}

/**
 * The conversation the sidebar should fall back to once `chatId` is gone: the
 * list rows are newest-first (see groupSessions), so this is its top row, and an
 * empty list means the agent has no conversation left.
 */
export function topConversationExcluding(rows: SessionSummary[], chatId: string | null): SessionSummary | null {
  return rows.find((row) => row.chat_id !== chatId) ?? null
}

// sessionEqualityKey fingerprints a session row for change detection.
function sessionEqualityKey(s: SessionSummary): string {
  return `${s.id}|${s.updated_at}|${s.title ?? ''}|${s.message_count}|${s.status}`
}

// sameSessionList reports whether two lists carry identical rows, so the UI can
// skip a redraw when a refresh changed nothing.
export function sameSessionList(a: SessionSummary[], b: SessionSummary[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const keys = new Set(a.map(sessionEqualityKey))
  for (const s of b) {
    if (!keys.has(sessionEqualityKey(s))) {
      return false
    }
  }
  return true
}

// mergeSessionRows overlays incoming rows onto the base list by id: existing
// rows are updated in place and new rows appended, so paged/refreshed fetches
// never drop already-loaded conversations.
export function mergeSessionRows(
  base: SessionSummary[] | undefined | null,
  incoming: SessionSummary[] | undefined | null,
): SessionSummary[] {
  const map = new Map((base ?? []).map((s) => [s.id, s]))
  for (const s of incoming ?? []) {
    map.set(s.id, s)
  }
  return [...map.values()]
}

/** Version of a stored segment id: `web:x` is version 0, `web:x:v3` is 3. */
export function segmentVersionOf(sessionId: string): number {
  const match = /:v(\d+)$/.exec(sessionId)
  return match ? Number(match[1]) : 0
}

/**
 * The row just older than `sessionId` in the same conversation, by version.
 *
 * `meta.handoff_from` is the source of truth for the chain, but rows written
 * before compaction started recording it have no predecessor, and then the
 * transcript would stop at that segment. The sidebar list already holds every row
 * of the agent (archived ones included), so the chain can be inferred from it:
 * the known segment with the highest version below this one.
 */
export function previousSegmentFallback(segments: SessionSummary[], sessionId: string): string | null {
  const chatId = conversationKeyOf(sessionId)
  if (!chatId) {
    return null
  }
  const version = segmentVersionOf(sessionId)
  let best: { id: string; version: number } | null = null
  for (const row of segments) {
    if (row.id === sessionId || row.chat_id !== chatId) {
      continue
    }
    const candidate = segmentVersionOf(row.id)
    if (candidate >= version) {
      continue
    }
    if (!best || candidate > best.version) {
      best = { id: row.id, version: candidate }
    }
  }
  return best?.id ?? null
}

/**
 * Whether a stored session can be resumed: its row exists and is the active one.
 * A conversation the gateway named for a new chat has no row at all until the
 * agent picks a message up, so remembering it would make the next attempt resume
 * something the gateway rejects.
 */
export function isResumableSession(entry: SessionListEntry, sessionId: string): boolean {
  return entry.rows.some((row) => row.id === sessionId)
}

/**
 * The session a tab has to reconnect to when its pane is mounted again.
 *
 * A fresh conversation is named by the gateway before any row exists, so the tab
 * keeps no session id while it lives (binding it would make the tab re-read a
 * segment that is not there yet). Without this the pane came back with no session
 * at all, and the gateway answers a session-less connection with a *new*
 * conversation: the transcript came back empty and only the newest stream showed.
 *
 * The list is asked first, because it knows the segment the conversation is on
 * now; the id the socket was last named is the fallback for the window before the
 * first row is in the list.
 */
export function resolveResumeSession(
  entry: SessionListEntry,
  tab: { chatId: string | null; resumeSessionId?: string | null },
): string | null {
  const chatId = tab.chatId
  if (chatId) {
    let best: { id: string; version: number } | null = null
    for (const row of entry.rows) {
      if (row.chat_id !== chatId) {
        continue
      }
      const version = segmentVersionOf(row.id)
      if (!best || version > best.version) {
        best = { id: row.id, version }
      }
    }
    if (best) {
      return best.id
    }
  }
  return tab.resumeSessionId ?? null
}

/** What to do when the socket reports that its session is unknown. */
export type InvalidSessionAction =
  /** The conversation moved to another segment: follow the row the list shows. */
  | { kind: 'repoint'; sessionId: string }
  /** The conversation is really gone: the tab has nothing left to show. */
  | { kind: 'close' }
  /** The bucket cannot be trusted, so keep the tab and make it a new conversation. */
  | { kind: 'clear' }

/**
 * Decides how a tab recovers from "the server does not know this session".
 *
 * The important part is what may *not* be concluded: the sidebar only holds the
 * rows it has paged in (page one unless the reader scrolled) and a bucket can
 * still be carrying an error, so a conversation missing from those rows is not
 * evidence that it is gone — it may simply be older than the loaded page, or the
 * fetch that would have refreshed the rows may have failed. Closing the tab on
 * that guess also drags the sidebar to whichever agent's tab becomes active
 * (the sidebar follows the active tab), which reads as "this agent cannot be
 * selected". Only a bucket that was fetched successfully and is not stale may
 * declare a conversation gone.
 */
export function invalidSessionAction(
  entry: SessionListEntry,
  chatId: string | null,
  sessionId: string | null,
): InvalidSessionAction {
  if (!chatId) {
    // The tab never had a conversation to lose (a fresh chat), so the list has
    // nothing to say about it.
    return { kind: 'clear' }
  }
  const current = entry.rows.find((session) => session.chat_id === chatId)
  if (current && current.id !== sessionId) {
    return { kind: 'repoint', sessionId: current.id }
  }
  const trustworthy = entry.fetchedAt > 0 && !entry.error && !entry.loading
  // Absence from the list is not enough to close a tab. A conversation the
  // gateway named but nothing was ever sent into has no row at all, and a tab
  // holding it must survive as a fresh conversation (closing it there is what
  // made a tab flash and disappear on re-selecting an agent). Closing needs
  // evidence that the conversation exists but is no longer active: its row is
  // still present in the ungrouped rows, which keep archived segments.
  const knownButInactive = entry.segments.some((row) => row.chat_id === chatId)
  if (trustworthy && !current && knownButInactive) {
    return { kind: 'close' }
  }
  return { kind: 'clear' }
}
