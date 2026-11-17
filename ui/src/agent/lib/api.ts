// The portal's data client, as this module can reach it.
//
// The chat surface moved out of the shell, so these helpers no longer own a
// session: the transport comes from the host the shell installs (`getHost().api`
// refreshes an expiring access token once for every caller), and the raw calls
// that need their own headers carry the host's token. The URL prefixes below are
// the platform's public ones — nginx routes them by owner — so they stay spelled
// here as constants instead of being guessed from a build base.

import { getHost } from '../../host'
import i18n from '../i18n'
import type { ConversationAttention } from '../conversations/attention'

export const ADMIN_API_BASE = '/api/v1/admin'
export const PORTAL_ADMIN_API_BASE = '/api/admin/v1'
export const USER_API_BASE = '/api/user/v1'
export const WORKSPACE_API_BASE = '/api/v1/workspace'
export const AUTH_API_BASE = '/api/v1/auth'

export async function fetchJson<T>(path: string, base = ADMIN_API_BASE): Promise<T> {
  return getHost().api.get<T>(path, base)
}

export async function postJson<T>(
  path: string,
  body: unknown,
  base = ADMIN_API_BASE,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return getHost().api.post<T>(path, body, base)
  }
  // A caller that may abort (dictation) keeps its signal: the host's client has
  // no way to pass one through, so this single call is made directly.
  const response = await authorizedFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  return (await response.json()) as T
}

export async function putJson<T>(path: string, body: unknown, base = ADMIN_API_BASE): Promise<T> {
  return getHost().api.put<T>(path, body, base)
}

export async function patchJson<T>(path: string, body: unknown, base = ADMIN_API_BASE): Promise<T> {
  return getHost().api.patch<T>(path, body, base)
}

export async function deleteJson<T>(path: string, base = ADMIN_API_BASE): Promise<T> {
  return getHost().api.del<T>(path, base)
}

/** authorizedFetch is the raw call: a streamed body or a conditional request. */
export function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${getHost().token}`, ...(init?.headers as Record<string, string> | undefined) },
  })
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export type AgentDetail = {
  id: string
  user_id: string
  group_id?: string
  display_name: string
  description: string
  model: string
  status: string
  tools: string[]
  owner_display_name?: string
}

export type AgentInput = {
  user_id?: string
  type_id?: string
  display_name: string
  description?: string
  default_agent?: string
  group_id?: string
  settings?: Record<string, string>
}

export type AgentSettingRead = {
  key: string
  agent_value: string
  platform_default: string
  effective: string
  source: 'agent' | 'platform'
}

export type UserSummary = {
  user_id: string
  display_name: string
  status: string
  tier: string
  role: string
  auth_source?: string
  channels: string[]
  agent_status: string
  last_activity_at: string
}

export async function readAgentSetting(agentID: string, key: string): Promise<AgentSettingRead> {
  return fetchJson<AgentSettingRead>(
    `/agents/${encodeURIComponent(agentID)}/settings/${encodeURIComponent(key)}`,
    USER_API_BASE,
  )
}

export type SessionSummary = {
  id: string
  agent_id: string
  account_id: string
  channel: string
  chat_id: string
  status: string
  title?: string
  message_count: number
  turn_running?: boolean
  created_at: string
  updated_at: string
}

export type SessionPage = {
  agent_id: string
  sessions: SessionSummary[]
  count: number
  total: number
  has_more: boolean
}

export type AgentSessionDetail = {
  session_id: string
  agent_id: string
  account_id: string
  channel: string
  chat_id: string
  status: string
  messages: string
  summary: string
  meta?: string
  turn_running?: boolean
  created_at: string
  updated_at: string
  total?: number
  before?: number
  has_more?: boolean
}

export { NANOWORK_EXTENSIONS, canOpenFile, classifyFileType, type FileKind } from '../lib/fileTypes'

export type FileEntry = {
  name: string
  is_dir: boolean
  size?: number
  modified?: number
  runtime?: boolean
}

export type FileListing = {
  agent_id: string
  path: string
  entries: FileEntry[]
}

export async function createAgent(input: AgentInput): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>('/agents', input, USER_API_BASE)
}

export async function updateAgent(agentID: string, input: AgentInput): Promise<{ id: string; status: string }> {
  return putJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}`, input, USER_API_BASE)
}

export async function deleteAgent(agentID: string): Promise<{ id: string; status: string }> {
  return deleteJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}`, USER_API_BASE)
}

export async function provisionAgent(agentID: string): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}/provision`, {}, USER_API_BASE)
}

export async function restartAgent(agentID: string): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}/restart`, {}, USER_API_BASE)
}

export async function restoreAgent(agentID: string): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}/restore`, {}, USER_API_BASE)
}

export async function listAgentSessions(
  agentID: string,
  opts?: { limit?: number; offset?: number },
): Promise<SessionPage> {
  const params = new URLSearchParams()
  if (opts?.limit) {
    params.set('limit', String(opts.limit))
  }
  if (opts?.offset) {
    params.set('offset', String(opts.offset))
  }
  const qs = params.toString()
  return fetchJson<SessionPage>(
    `/agents/${encodeURIComponent(agentID)}/sessions${qs ? `?${qs}` : ''}`,
    USER_API_BASE,
  )
}

export async function listAgentAttention(): Promise<ConversationAttention[]> {
  const body = await fetchJson<{ conversations: ConversationAttention[] }>('/agents/attention', USER_API_BASE)
  return body.conversations ?? []
}

export type AgentSessionRead =
  | { notModified: true }
  | { notModified: false; detail: AgentSessionDetail; etag?: string }

export async function readAgentSession(
  sessionID: string,
  opts?: { limit?: number; before?: number; etag?: string },
): Promise<AgentSessionRead> {
  const params = new URLSearchParams()
  if (opts?.limit) {
    params.set('limit', String(opts.limit))
  }
  if (opts?.before !== undefined) {
    params.set('before', String(opts.before))
  }
  const qs = params.toString()
  const headers: Record<string, string> = {}
  if (opts?.etag) {
    headers['If-None-Match'] = opts.etag
  }
  const response = await authorizedFetch(
    `${USER_API_BASE}/sessions/${encodeURIComponent(sessionID)}${qs ? `?${qs}` : ''}`,
    { headers },
  )
  if (response.status === 304) {
    return { notModified: true }
  }
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  const detail = (await response.json()) as AgentSessionDetail
  return { notModified: false, detail, etag: response.headers.get('ETag') ?? undefined }
}

export async function readAgentSessionMeta(sessionID: string): Promise<AgentSessionDetail> {
  return fetchJson<AgentSessionDetail>(`/sessions/${encodeURIComponent(sessionID)}?meta=1`, USER_API_BASE)
}

export async function archiveAgentSession(sessionID: string): Promise<{ status: string }> {
  return deleteJson<{ status: string }>(`/sessions/${encodeURIComponent(sessionID)}`, USER_API_BASE)
}

export function fileListingPath(agentID: string, path: string): string {
  return `/files/${encodeURIComponent(agentID)}${path ? `?path=${encodeURIComponent(path)}` : ''}`
}

export async function listFiles(agentID: string, path: string): Promise<FileListing> {
  return fetchJson<FileListing>(fileListingPath(agentID, path), WORKSPACE_API_BASE)
}

async function contentResponse(agentID: string, path: string, init?: RequestInit): Promise<Response> {
  const query = `?path=${encodeURIComponent(path)}`
  return authorizedFetch(`${WORKSPACE_API_BASE}/files/${encodeURIComponent(agentID)}/content${query}`, init)
}

export async function downloadFile(agentID: string, path: string): Promise<Blob> {
  const response = await contentResponse(agentID, path)
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.downloadFailed', { status: response.status }))
  }
  return response.blob()
}

export async function readTextFile(agentID: string, path: string): Promise<string | null> {
  const response = await contentResponse(agentID, path)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.downloadFailed', { status: response.status }))
  }
  return response.text()
}

export async function uploadFile(agentID: string, path: string, body: Blob): Promise<{ status: string }> {
  const query = `?path=${encodeURIComponent(path)}`
  const response = await authorizedFetch(`${WORKSPACE_API_BASE}/files/${encodeURIComponent(agentID)}/content${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.uploadFailed', { status: response.status }))
  }
  return (await response.json()) as { status: string }
}

export async function deleteFile(agentID: string, path: string): Promise<{ status: string }> {
  const query = `?path=${encodeURIComponent(path)}`
  const response = await authorizedFetch(`${WORKSPACE_API_BASE}/files/${encodeURIComponent(agentID)}/content${query}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.deleteFailed', { status: response.status }))
  }
  return (await response.json()) as { status: string }
}

export async function createFolder(agentID: string, path: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/files/${encodeURIComponent(agentID)}/mkdir?path=${encodeURIComponent(path)}`,
    {},
    WORKSPACE_API_BASE,
  )
}

export async function renameEntry(agentID: string, from: string, to: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/files/${encodeURIComponent(agentID)}/rename?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {},
    WORKSPACE_API_BASE,
  )
}

export async function copyEntry(agentID: string, from: string, to: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/files/${encodeURIComponent(agentID)}/copy?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {},
    WORKSPACE_API_BASE,
  )
}

export type TerminalSessionInfo = {
  terminal_id: string
  agent_id: string
  created_at: number
}

export type TerminalAttachment = {
  terminal_id: string
  replay?: string
}

export async function listTerminals(agentId: string): Promise<TerminalSessionInfo[]> {
  const data = await fetchJson<{ terminals: TerminalSessionInfo[] }>(
    `/agents/${encodeURIComponent(agentId)}/terminals`,
    USER_API_BASE,
  )
  return data.terminals ?? []
}

export async function attachTerminal(
  agentId: string,
  body: { terminal_id?: string; cols?: number; rows?: number },
): Promise<TerminalAttachment> {
  return postJson<TerminalAttachment>(
    `/agents/${encodeURIComponent(agentId)}/terminals/attach`,
    body,
    USER_API_BASE,
  )
}

export async function killTerminal(agentId: string, terminalId: string): Promise<{ status: string }> {
  return deleteJson<{ status: string }>(
    `/agents/${encodeURIComponent(agentId)}/terminals/${encodeURIComponent(terminalId)}`,
    USER_API_BASE,
  )
}
