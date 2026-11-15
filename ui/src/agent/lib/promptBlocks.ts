// The session agents' prompt blocks. Build and Plan share one head prompt — that
// is what keeps the request prefix identical across a mode switch — and each mode
// has its own short switch note, appended to the end of every request.
//
// The user plane is read-only: it reports the effective head and where it came
// from, so a reader can tell a platform default from an override.

import { fetchJson, putJson, USER_API_BASE } from './api'

export type PromptBlock = { content: string; scope?: string } | null

export type AgentPromptBlocks = {
  agent_id: string
  head: PromptBlock
  /** 'platform' when the shared head comes from the platform row, 'agent' when the
   * agent has its own override. */
  head_source: 'platform' | 'agent'
  /** One switch note per mode, keyed by the session agent id. */
  mode_notes: Record<string, string>
}

export function getAgentPromptBlocks(agentID: string, userID: string): Promise<AgentPromptBlocks> {
  return fetchJson<AgentPromptBlocks>(
    `/agents/${encodeURIComponent(agentID)}/prompt-blocks?user_id=${encodeURIComponent(userID)}`,
    USER_API_BASE,
  )
}

/** The admin view of the same blocks: the platform's shared head prompt, plus the
 * mode switch notes (which live on the agent type prompts). */
export type AdminPromptBlocks = {
  head: PromptBlock
  mode_notes: Record<string, string>
}

export function getAdminPromptBlocks(): Promise<AdminPromptBlocks> {
  return fetchJson<AdminPromptBlocks>('/prompt-blocks')
}

export function saveAdminPromptBlock(content: string): Promise<{ block: string; status: string }> {
  return putJson<{ block: string; status: string }>('/prompt-blocks', { block: 'session-head', content })
}
