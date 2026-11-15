// Whether the pane must keep showing "working" instead of reconciling it away.
//
// `turn_running` is the server's own answer and normally settles the question,
// but a compaction is a special case: its pre-compaction memory flush and its
// summary are long inner LLM calls that emit nothing to the client, so a
// reconciliation on stream silence alone (five seconds) declared the command
// finished. The divider stopped flashing, the composer went back to idle and the
// running dots stopped — while the compaction was still running, which is why the
// state came back by itself once the first summary chunk arrived.
//
// The transcript carries its own evidence for a bounded window: a streaming
// compaction block only exists while a compaction is running, and every summary
// chunk refreshes it. Bounding the window is what keeps a crashed agent from
// holding the indicator on forever — the same convergence the server flag gets
// from its staleness check.

/** How long a streaming compaction block may postpone the self-heal. */
export const COMPACTION_SILENCE_BUDGET_MS = 120_000

export type TurnAliveInput = {
  /** The server's turn flag (the bus has already applied its staleness check). */
  serverRunning: boolean
  /** The transcript's last block is a compaction divider that is still streaming. */
  streamingCompaction: boolean
  /** When that evidence stops counting (0 = never armed). */
  compactionDeadline: number
  /** Time since the last streamed chunk of any kind. */
  sinceLastChunkMs: number
  /** How long a silent stream is still believed to be part of a turn. */
  quietMs: number
  now: number
}

/** Whether the running indicator is still legitimate. */
export function turnLooksAlive(i: TurnAliveInput): boolean {
  if (i.serverRunning) {
    return true
  }
  if (i.streamingCompaction && i.compactionDeadline > i.now) {
    return true
  }
  return i.sinceLastChunkMs < i.quietMs
}
