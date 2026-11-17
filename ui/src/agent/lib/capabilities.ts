import { deleteJson, fetchJson, postJson, putJson } from './api'

const USER_BASE = '/api/user/v1'

export type McpDef = {
  id: string
  scope: 'platform' | 'user'
  owner_user_id?: string
  name: string
  description: string
  transport: 'http' | 'sse'
  url?: string
  headers?: Record<string, string>
  default_enabled: boolean
  locked: '' | 'on' | 'off'
}

export type McpInput = {
  id?: string
  name: string
  description?: string
  transport: 'http' | 'sse'
  url?: string
  headers?: Record<string, string>
  default_enabled: boolean
  locked?: '' | 'on' | 'off'
}

export type McpTool = { name: string; description?: string }

export type McpTestResult = {
  ok: boolean
  latency_ms?: number
  error?: string
  tools?: McpTool[]
  server_name?: string
  protocol_version?: string
}

export type SkillDef = {
  id: string
  scope: 'platform' | 'user'
  owner_user_id?: string
  name: string
  description: string
  files: Record<string, string>
  default_enabled: boolean
  locked: '' | 'on' | 'off'
  // origin='bundled' marks a read-only skill shipped with the nanobus binary;
  // its content and lifecycle are managed by code, not the admin API.
  origin?: 'platform' | 'bundled' | 'human' | 'agent'
}

export type SkillInput = {
  id?: string
  name: string
  description?: string
  files: Record<string, string>
  default_enabled: boolean
  locked?: '' | 'on' | 'off'
}

export type BuiltinDef = {
  id: string
  description?: string
  default_enabled: boolean
  locked: '' | 'on' | 'off'
}

export type AgentCapView = {
  agent_id: string
  type_id?: string
  agent_type?: AgentCapAgentType | null
  permissions?: PermissionRule[]
  agent_permissions?: PermissionRule[]
  builtin_tools: AgentCapItem[]
  mcp: AgentCapItem[]
  skills: AgentCapItem[]
}

export type PermissionRule = { pattern: string; action: 'allow' | 'ask' | 'deny' }

export type PermissionKey = {
  id: string
  description?: string
  default_action: 'allow' | 'ask' | 'deny'
  read_only: boolean
}

export type AgentCapModelBinding = { model_id: number; is_default: boolean; locked: boolean }

export type AgentCapAgentType = {
  id: string
  kind?: string
  name: string
  prompt?: string
  models?: AgentCapModelBinding[]
  channel_fallbacks?: Record<string, string>
}

export type AgentCapItem = {
  id: string
  name?: string
  description?: string
  default_enabled: boolean
  locked: '' | 'on' | 'off'
  override: boolean | null
  effective: boolean
  update_available?: boolean
  acked_version?: number
  published_version?: number
  extra?: { transport?: string; url?: string }
}

// ======== skill acknowledgement + user secrets ========

export const ackSkill = (skillId: string, version: number) =>
  postJson('/skill-acks', { skill_id: skillId, version }, USER_BASE)

export const listSecrets = (kind: string, ref: string) =>
  fetchJson<{ secrets: Record<string, string>; count: number }>(
    `/secrets/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}`,
    USER_BASE,
  )

export const setSecret = (kind: string, ref: string, key: string, value: string) =>
  putJson(`/secrets/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}`, { key, value }, USER_BASE)

export const deleteSecret = (kind: string, ref: string, key: string) =>
  deleteJson(
    `/secrets/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}?key=${encodeURIComponent(key)}`,
    USER_BASE,
  )

// ======== admin ========

export const listBuiltinTools = () => fetchJson<{ tools: BuiltinDef[] }>('/capabilities/builtin')
export const updateBuiltin = (id: string, body: { default_enabled?: boolean; locked?: '' | 'on' | 'off' }) =>
  putJson(`/capabilities/builtin/${encodeURIComponent(id)}`, body)

export const listAdminMcp = () => fetchJson<{ servers: McpDef[] }>('/capabilities/mcp')
export const createAdminMcp = (body: McpInput) => postJson('/capabilities/mcp', body)
export const updateAdminMcp = (id: string, body: McpInput) => putJson(`/capabilities/mcp/${encodeURIComponent(id)}`, body)
// updateMcpState edits only the global default (default_enabled/locked).
export const updateMcpState = (id: string, body: { default_enabled?: boolean; locked?: '' | 'on' | 'off' }) =>
  putJson(`/capabilities/mcp/${encodeURIComponent(id)}/state`, body)
export const deleteAdminMcp = (id: string) => deleteJson(`/capabilities/mcp/${encodeURIComponent(id)}`)
export const testAdminMcp = (body: { id?: string; transport?: string; url?: string; headers?: Record<string, string> }) =>
  postJson<McpTestResult>('/capabilities/mcp/test', body)

export const listAdminSkills = () => fetchJson<{ skills: SkillDef[] }>('/capabilities/skills')
export const createAdminSkill = (body: SkillInput) => postJson('/capabilities/skills', body)
export const updateAdminSkill = (id: string, body: SkillInput) => putJson(`/capabilities/skills/${encodeURIComponent(id)}`, body)
// updateSkillState edits only the global default (default_enabled/locked) and
// works for read-only bundled skills too.
export const updateSkillState = (id: string, body: { default_enabled?: boolean; locked?: '' | 'on' | 'off' }) =>
  putJson(`/capabilities/skills/${encodeURIComponent(id)}/state`, body)
export const deleteAdminSkill = (id: string) => deleteJson(`/capabilities/skills/${encodeURIComponent(id)}`)

// ======== user library ========

export const getLibrary = () =>
  fetchJson<{ servers: McpDef[]; skills: SkillDef[] }>('/library', USER_BASE)

export const createLibrary = (kind: 'mcp' | 'skills', body: McpInput | SkillInput) =>
  postJson(`/library/${kind}`, body, USER_BASE)
export const updateLibrary = (kind: 'mcp' | 'skills', id: string, body: McpInput | SkillInput) =>
  putJson(`/library/${kind}/${encodeURIComponent(id)}`, body, USER_BASE)
export const deleteLibrary = (kind: 'mcp' | 'skills', id: string) =>
  deleteJson(`/library/${kind}/${encodeURIComponent(id)}`, USER_BASE)
export const testLibraryMcp = (body: { id?: string; transport?: string; url?: string; headers?: Record<string, string> }) =>
  postJson<McpTestResult>('/library/mcp/test', body, USER_BASE)

// ======== per-agent ========

export const listMyPermissionKeys = () =>
  fetchJson<{ keys: PermissionKey[] }>('/permission-keys', USER_BASE)

// AgentTypeOverride mirrors the wire type: the user's per-(agent, mode) overrides.
export type AgentTypeOverride = {
  model_id?: number
  thinking?: string
  settings?: Record<string, string>
  permissions?: PermissionRule[]
  capabilities?: { kind: string; ref: string; enabled: boolean }[]
}

export type AgentModeView = {
  agent_id: string
  type_id: string
  type: import('./agentTypes').AgentType | null
  override: AgentTypeOverride | null
}

const modeQuery = (typeID?: string) => (typeID ? `?type_id=${encodeURIComponent(typeID)}` : '')

export const getAgentCapabilities = (agentID: string, typeID?: string) =>
  fetchJson<AgentCapView>(`/agents/${encodeURIComponent(agentID)}/capabilities${modeQuery(typeID)}`, USER_BASE)

export const setAgentPermissions = (agentID: string, permissions: PermissionRule[], typeID?: string) =>
  putJson(`/agents/${encodeURIComponent(agentID)}/permissions`, { permissions, type_id: typeID }, USER_BASE)
export const setAgentCapability = (agentID: string, kind: string, ref: string, enabled: boolean, typeID?: string) =>
  putJson(`/agents/${encodeURIComponent(agentID)}/capabilities`, { kind, ref, enabled, type_id: typeID }, USER_BASE)
export const resetAgentCapability = (agentID: string, kind: string, ref: string, typeID?: string) =>
  deleteJson(
    `/agents/${encodeURIComponent(agentID)}/capabilities?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}${typeID ? `&type_id=${encodeURIComponent(typeID)}` : ''}`,
    USER_BASE,
  )

// Per-(agent, mode) override config (model/thinking/settings).
export const getAgentMode = (agentID: string, typeID: string) =>
  fetchJson<AgentModeView>(`/agents/${encodeURIComponent(agentID)}/modes/${encodeURIComponent(typeID)}`, USER_BASE)

export const setAgentMode = (
  agentID: string,
  typeID: string,
  body: { model_id?: number; clear_model_id?: boolean; thinking?: string; settings?: Record<string, string> },
) => putJson(`/agents/${encodeURIComponent(agentID)}/modes/${encodeURIComponent(typeID)}`, body, USER_BASE)