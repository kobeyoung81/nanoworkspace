import i18n from '../i18n'

export type Agent = {
  id: string
  user_id: string
  type_id?: string
  /** The owner's private grouping for this agent; absent = ungrouped. */
  group_id?: string
  session_agents?: string[]
  default_agent?: string
  display_name: string
  description: string
  // Effective model display name for the agent's default mode (resolved by the
  // bus). Model/thinking overrides live per (agent, mode).
  model: string
  status: string
  tools: string[]
  workspaces: string[]
  created_at: string
  // Per-agent platform settings the user may edit (e.g. scheduled_task_mode).
  settings?: Record<string, string>
}

export type ChunkKind = 'content' | 'thought' | 'tool_use' | 'tool_result' | 'status' | 'question' | 'todo' | 'approval' | 'summary'

export type AgentEvent =
  | { type: 'ready'; chat_id: string; session_id?: string; agent_id?: string }
  | { type: 'chunk'; chat_id: string; agent_id?: string; message_id?: string; kind?: ChunkKind; content: string }
  | { type: 'complete'; chat_id: string; agent_id?: string; message_id?: string; session_id?: string; content: string; summary?: string; error?: string; error_detail?: string }
  | { type: 'error'; error: string }

// GATEWAY_URL points at the gateway web channel. When empty (the default), the
// portal's nginx proxies the gateway under the same origin, so no per-host
// build config is required.
export const GATEWAY_URL = (import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? ''

function gatewayBase(): string {
  return GATEWAY_URL.replace(/\/+$/, '')
}

export function agentWsUrl(agentId: string, token: string, sessionId?: string): string {
  let base: string
  if (GATEWAY_URL) {
    base = GATEWAY_URL.replace(/\/+$/, '').replace(/^http/, 'ws')
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    base = `${protocol}://${window.location.host}`
  }
  let url = `${base}/ws/agent/${encodeURIComponent(agentId)}?token=${encodeURIComponent(token)}`
  if (sessionId) {
    url += `&session_id=${encodeURIComponent(sessionId)}`
  }
  return url
}

// agentTerminalWsUrl points at the gateway's terminal WebSocket. Terminal io is
// multiplexed on one socket per panel; sessions are identified per frame.
export function agentTerminalWsUrl(agentId: string, token: string): string {
  let base: string
  if (GATEWAY_URL) {
    base = GATEWAY_URL.replace(/\/+$/, '').replace(/^http/, 'ws')
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    base = `${protocol}://${window.location.host}`
  }
  return `${base}/ws/agent/${encodeURIComponent(agentId)}/terminal?token=${encodeURIComponent(token)}`
}

export async function listAgents(token: string): Promise<Agent[]> {
  let response: Response
  try {
    response = await fetch(`${gatewayBase()}/api/v1/agents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error(i18n.t('errors.gatewayUnreachable'))
  }
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.listAgents', { status: response.status }))
  }
  const body = (await response.json()) as { agents: Agent[] }
  return body.agents ?? []
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
