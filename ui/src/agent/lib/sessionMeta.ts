// Session metadata: the `meta` JSON blob and the meta-only read.
//
// The sidebar's turn-end reconciliation only needs the small, mutable part of a
// session — todos, a pending question/approval, whether a turn is running — not
// the transcript. `?meta=1` answers without the messages blob (the server never
// reads it), which is what keeps a finished turn from replacing the whole
// message array and resetting the transcript's measured rows and scroll
// position.

import { readAgentSessionMeta } from './api'
import type { PendingApproval, PendingQuestion, TodoItem } from '../hooks/useAgent'

export type SessionMetaSnapshot = {
  todos?: TodoItem[]
  pendingQuestion: PendingQuestion | null
  pendingApproval: PendingApproval | null
  turnRunning: boolean
  /** A compaction is in flight (see `_compacting`): the transcript's own divider
   * is only written to the row when the summary is in, so a reload mid-command
   * needs this to show it again. */
  compacting: boolean
  /** The segment a compaction archived before this one, when the agent linked it. */
  previousSessionId?: string
  /** The session agent the last turn ran (`_session_agent`): the conversation's
   * own build/plan answer, carried across a compaction handoff and dropped by
   * /new (see lib/agentMode). */
  sessionAgent?: string
}

/** Parses the `meta` blob; each field is ignored when it is malformed. */
export function parseSessionMeta(meta?: string): Omit<SessionMetaSnapshot, 'turnRunning'> {
  const parsed: Omit<SessionMetaSnapshot, 'turnRunning'> = {
    todos: undefined,
    pendingQuestion: null,
    pendingApproval: null,
    compacting: false,
    previousSessionId: undefined,
  }
  if (!meta) {
    return parsed
  }
  let fields: Record<string, string>
  try {
    fields = JSON.parse(meta) as Record<string, string>
  } catch {
    return parsed
  }
  parsed.compacting = fields._compacting === 'true'
  if (fields._session_agent) {
    parsed.sessionAgent = fields._session_agent
  }
  if (fields.handoff_from) {
    parsed.previousSessionId = fields.handoff_from
  }
  if (fields.todos) {
    try {
      parsed.todos = JSON.parse(fields.todos) as TodoItem[]
    } catch {
      // ignore malformed todos
    }
  }
  if (fields._pending_question) {
    try {
      parsed.pendingQuestion = JSON.parse(fields._pending_question) as PendingQuestion
    } catch {
      // ignore malformed question
    }
  }
  if (fields._pending_approval) {
    try {
      parsed.pendingApproval = JSON.parse(fields._pending_approval) as PendingApproval
    } catch {
      // ignore malformed approval
    }
  }
  return parsed
}

/** Reads just the metadata of one session. */
export async function loadSessionMeta(sessionId: string): Promise<SessionMetaSnapshot> {
  const detail = await readAgentSessionMeta(sessionId)
  return { ...parseSessionMeta(detail.meta), turnRunning: detail.turn_running ?? false }
}
