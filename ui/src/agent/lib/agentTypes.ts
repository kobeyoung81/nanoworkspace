import { deleteJson, fetchJson, postJson, putJson } from './api'
import type { AgentPromptStatus } from './promptStatus'

export type PermissionAction = 'allow' | 'ask' | 'deny'
export type PermissionRule = { pattern: string; action: PermissionAction }
export type TypeModelBinding = { model_id: number; is_default: boolean; locked: boolean }
export type TypeCapabilityBinding = {
  kind: string
  ref: string
  default_enabled: boolean
  locked?: string
  params?: string
  permissions?: PermissionRule[]
}
export type AgentType = {
  id: string
  role?: string
  name: string
  description?: string
  prompt?: string
  max_rounds?: number
  // Execution attributes. The runtime derives the worker shape from these:
  // session = stream+shared, subagent = caller, utility = oneshot.
  strategy?: string
  context?: string
  output?: string
  session_binding?: string
  channel_fallbacks?: Record<string, string>
  permissions?: PermissionRule[]
  // Runtime policy/tool settings (see nanoprotocol AgentTypeDef.Settings).
  settings?: Record<string, string>
  seeded?: boolean
  models?: TypeModelBinding[]
  capabilities?: TypeCapabilityBinding[]
}
export type PermissionKey = {
  id: string
  description?: string
  default_action: PermissionAction
  read_only: boolean
}

export const listAgentTypes = (all = false) =>
  fetchJson<{ types: AgentType[] }>(`/agent-types${all ? '?all=true' : ''}`)

// Where a type's stored prompt stands relative to the bundle the bus ships.
// The prompt text itself comes with the type; only the bundle in the bus knows
// whether that text is still the platform's, an older seed, or an edit.
export type { AgentPromptStatus, PromptSource } from './promptStatus'

export const listAgentTypePromptStatus = () =>
  fetchJson<{ items: AgentPromptStatus[] }>('/agent-types/prompt-status')

export const resetAgentTypePrompt = (id: string) =>
  postJson<{ id: string; status: string }>(`/agent-types/${encodeURIComponent(id)}/prompt/reset`, {})

export const getAgentType = (id: string) => fetchJson<AgentType>(`/agent-types/${encodeURIComponent(id)}`)

export const saveAgentType = (t: AgentType) =>
  t.id ? putJson(`/agent-types/${encodeURIComponent(t.id)}`, t) : postJson('/agent-types', t)

export const deleteAgentType = (id: string) => deleteJson(`/agent-types/${encodeURIComponent(id)}`)

export const listPermissionKeys = () => fetchJson<{ keys: PermissionKey[] }>('/permission-keys')

// setTypeCapability upserts one per-type capability baseline (default_enabled
// + locked) for builtin tools, MCP servers and skills.
export const setTypeCapability = (
  typeID: string,
  body: { kind: string; ref: string; default_enabled: boolean; locked: '' | 'on' | 'off' },
) =>
  putJson(`/agent-types/${encodeURIComponent(typeID)}/capabilities`, body)

// deleteTypeCapability removes a type's capability baseline row so the type
// inherits the global (definition-plane) default again.
export const deleteTypeCapability = (typeID: string, kind: string, ref: string) =>
  deleteJson(
    `/agent-types/${encodeURIComponent(typeID)}/capabilities?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}`,
  )

// Assignable conversational agent types for the signed-in user.
// The user-facing catalog is the session agents (build/plan) and nothing else:
// helper definitions are platform-owned, and the bus endpoint no longer widens
// for any query string. See nanobus's restListMyAgentTypes.
export const listAssignableAgentTypes = () =>
  fetchJson<{ types: AgentType[] }>('/agent-types', '/api/user/v1')
