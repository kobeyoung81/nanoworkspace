// The composer's build/plan switch, and where a conversation's mode comes from.
//
// The pick is per conversation: a new conversation starts on the agent's
// configured default, and an existing one remembers what it last ran in. That
// memory belongs to the conversation, not to this browser — every turn records
// the session agent it resolved into the session's `_session_agent` meta key,
// which a compaction handoff carries onto the new segment and /new deliberately
// drops. Any device of the same account reads it back with the session.
//
// It used to be a per-agent value in localStorage: two conversations of one
// agent shared one switch, and another device knew nothing about either. The key
// is written by nanosec (internal/agent/session_handoff.go, noteSessionAgent) —
// renaming it there breaks this mapping.

import type { AgentMode } from '../hooks/useAgent'

/** The mode a conversation last ran in, from its `_session_agent` meta value. */
export function conversationModeOf(sessionAgent: string | null | undefined): AgentMode | null {
  // Only the two platform session agents name a mode. Anything else — absent on
  // a session that has not run a turn yet, empty, or an id this client does not
  // know — is "no answer", which falls back to the agent's default rather than
  // silently to build.
  if (sessionAgent === 'plan' || sessionAgent === 'build') {
    return sessionAgent
  }
  return null
}

/** The mode an agent starts a conversation in, from its `default_agent`. */
export function defaultModeOf(defaultAgent: string | null | undefined): AgentMode {
  return defaultAgent === 'plan' ? 'plan' : 'build'
}

/**
 * The mode the composer shows: a pick made in this pane wins (the user just made
 * it, and a background metadata read must not take it back), then what the
 * conversation last ran in, then the agent's default.
 */
export function resolveAgentMode(
  manual: AgentMode | null,
  conversation: AgentMode | null,
  agentDefault: AgentMode,
): AgentMode {
  return manual ?? conversation ?? agentDefault
}
