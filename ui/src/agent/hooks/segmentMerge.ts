// Pure transcript-merging helpers.
//
// These live outside useAgent so they can be reasoned about (and tested) without
// a socket: the hook owns the connection and the loading state, this module owns
// what a merge *means*.
import type { AgentMessage } from './useAgent'

/** Whether a transcript entry is an unconfirmed (optimistic) user message. */
export function isPendingUser(message: AgentMessage): message is Extract<AgentMessage, { role: 'user' }> {
  return message.role === 'user' && message.pending === true
}

/**
 * Clears the `pending` marker from user bubbles the stored history has recorded,
 * and keeps the ones it has not. Matching is by content, consuming the oldest
 * confirmed occurrence first, so sending the same text twice does not promote
 * both bubbles at once.
 */
export function reconcilePending(messages: AgentMessage[], persisted: AgentMessage[]): AgentMessage[] {
  const confirmed = new Map<string, number>()
  for (const message of persisted) {
    if (message.role === 'user') {
      confirmed.set(message.content, (confirmed.get(message.content) ?? 0) + 1)
    }
  }
  return messages.map((message) => {
    if (!isPendingUser(message)) {
      return message
    }
    const left = confirmed.get(message.content) ?? 0
    if (left <= 0) {
      return message
    }
    confirmed.set(message.content, left - 1)
    return { ...message, pending: false }
  })
}

/**
 * Puts what the socket streamed while the row was being read *after* it.
 *
 * The stored row and the live blocks describe the same tail of the turn: the row
 * lags the stream, and the agent syncs the session while it streams, so the row
 * may already carry a prefix of the answer. Keeping both would show that prefix
 * twice, and keeping only the row would cut the answer and break the streaming
 * block's continuation (chunks append by message id). So the live block wins and
 * the row's overlapping last message is dropped.
 */
function mergeLiveOntoHistory(persisted: AgentMessage[], tail: AgentMessage[]): AgentMessage[] {
  const stillPending = reconcilePending(tail, persisted).filter(isPendingUser)
  const rows = [...persisted]
  const live = tail.filter((m) => !isPendingUser(m))

  const last = rows[rows.length - 1]
  const first = live[0]
  if (
    last?.role === 'assistant' &&
    (last.kind === 'content' || last.kind === 'thought') &&
    first?.role === 'assistant' &&
    (first.kind === 'content' || first.kind === 'thought') &&
    last.kind === first.kind &&
    first.content.startsWith(last.content)
  ) {
    rows.pop()
  }
  return [...rows, ...live, ...stillPending]
}

/**
 * Merges a freshly read segment into the transcript.
 *
 * `prefixCount` is how many leading entries belong to older segments already in
 * memory and must be left untouched. The rest is the current segment plus
 * whatever the socket streamed; it is replaced by the server's view unless a
 * turn is streaming (mid-turn the stored row lags the stream), and unconfirmed
 * user messages are always preserved at the end.
 *
 * `headLoaded` says whether this segment has been merged in before. A transcript
 * that has no stored base yet (a fresh mount, a reload taken while the turn is
 * streaming, a re-read after the conversation identity changed) must keep the
 * row and append the live blocks: returning `current` there throws the whole
 * history away and leaves only the newest stream on screen.
 */
export function mergeSegment(
  current: AgentMessage[],
  persisted: AgentMessage[],
  prefixCount: number,
  headLoaded = true,
): AgentMessage[] {
  const prefix = current.slice(0, prefixCount)
  const tail = current.slice(prefixCount)
  if (tail.some((m) => m.streaming)) {
    if (headLoaded) {
      return current
    }
    return [...prefix, ...mergeLiveOntoHistory(persisted, tail)]
  }
  const reconciled = reconcilePending(tail, persisted)
  const stillPending = reconciled.filter(isPendingUser)
  return [...prefix, ...persisted, ...stillPending]
}

/**
 * Puts an older segment in front of everything already on screen. Older first is
 * the whole point: the transcript reads oldest → newest, and the new head of the
 * array must stay the oldest message.
 */
export function prependSegment(current: AgentMessage[], older: AgentMessage[]): AgentMessage[] {
  return [...older, ...current]
}

export type ChainState = {
  /** The segment the last read pointed at as its predecessor. */
  prev: string | null
  /** How many hops have been made in this walk. */
  hops: number
  /** Segments already in memory. */
  loaded: ReadonlySet<string>
  /** Hop cap, so a malformed handoff chain cannot loop. */
  maxHops: number
}

/**
 * The next older segment to read, or null when the walk is finished: no
 * predecessor, an already loaded one, or the hop cap reached. Keeping this
 * decision here is what guarantees a cyclic handoff chain terminates.
 */
export function nextSegmentToRead(state: ChainState): string | null {
  if (!state.prev || state.hops >= state.maxHops || state.loaded.has(state.prev)) {
    return null
  }
  return state.prev
}
