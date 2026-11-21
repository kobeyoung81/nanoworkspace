// The long-running goal API, over this module's own endpoints.
//
// The draft is a server object (design §13), so the card never holds the truth:
// every edit is a call, and the six-check verdict that decides whether "开始" is
// enabled comes back with each answer.

import { getHost } from '../../host'

export type GoalVerdict = {
  filled: string[]
  missing: string[]
  blockers: string[]
  risks: string[]
}

export type GoalEvidence = {
  kind: string
  cmd?: string
  exit?: number
  tail?: string
  path?: string
  note?: string
  items?: { text: string; done: boolean }[]
}

export type Goal = {
  id: string
  user_id: string
  agent_id: string
  session_key: string
  origin?: string
  title?: string
  condition?: string
  proof?: GoalEvidence[]
  constraints?: string[]
  plan_ref?: string
  mode?: string
  status: string
  status_reason?: string
  round: number
  max_rounds: number
  max_minutes: number
  verify_result?: string
  pause_reason?: string
  last_verdict?: string
  last_reason?: string
  last_missing?: string[]
  rounds?: { n: number; verdict: string; files: number; at: string }[]
  result?: { verdict: string; reason: string; rounds: number; minutes: number; at: string }
  no_progress_rounds?: number
  started_at?: string
  ended_at?: string
  next_round_at?: string
  updated_at?: string
}

export type DraftView = {
  draft: Goal
  verdict: GoalVerdict
}

function base(): string {
  return getHost().api.bases.workspace
}

/** createDraft opens (or returns) the conversation's unfinished draft. */
export function createDraft(
  agentId: string,
  sessionKey: string,
  planRef?: string,
  condition?: string,
): Promise<DraftView> {
  return getHost().api.post<DraftView>(
    '/goals/drafts',
    {
      agent_id: agentId,
      session_key: sessionKey,
      origin: planRef ? 'plan' : 'manual',
      plan_ref: planRef,
      condition,
    },
    base(),
  )
}

/** answerDraft fills one of the six checks. */
export function answerDraft(id: string, check: string, value: string): Promise<DraftView> {
  return getHost().api.post<DraftView>(
    `/goals/drafts/${encodeURIComponent(id)}/answer`,
    { check, value },
    base(),
  )
}

/** patchDraft edits several fields at once (title, condition, constraints…). */
export function patchDraft(id: string, patch: Record<string, unknown>): Promise<DraftView> {
  return getHost().api.patch<DraftView>(`/goals/drafts/${encodeURIComponent(id)}`, patch, base())
}

/** startDraft runs the six checks and, when they pass, starts the first round. */
export function startDraft(id: string): Promise<Goal> {
  return getHost().api.post<Goal>(`/goals/drafts/${encodeURIComponent(id)}/start`, {}, base())
}

export function getGoal(id: string): Promise<Goal> {
  return getHost().api.get<Goal>(`/goals/${encodeURIComponent(id)}`, base())
}

/** listGoals returns the caller's goals, newest first. */
export function listGoals(): Promise<{ goals: Goal[] }> {
  return getHost().api.get<{ goals: Goal[] }>('/goals', base())
}

export function listGoalsForSession(sessionKey: string): Promise<{ goals: Goal[] }> {
  return getHost().api.get<{ goals: Goal[] }>(
    `/goals?session_key=${encodeURIComponent(sessionKey)}`,
    base(),
  )
}

export function pauseGoal(id: string): Promise<{ status: string }> {
  return getHost().api.post<{ status: string }>(`/goals/${encodeURIComponent(id)}/pause`, {}, base())
}

export function resumeGoal(id: string): Promise<{ status: string }> {
  return getHost().api.post<{ status: string }>(`/goals/${encodeURIComponent(id)}/resume`, {}, base())
}

export function cancelGoal(id: string): Promise<{ status: string }> {
  return getHost().api.post<{ status: string }>(`/goals/${encodeURIComponent(id)}/cancel`, {}, base())
}

export function updateBudget(id: string, maxRounds: number, maxMinutes: number): Promise<unknown> {
  return getHost().api.post(`/goals/${encodeURIComponent(id)}/budget`, { max_rounds: maxRounds, max_minutes: maxMinutes }, base())
}

/** goalIsActive reports whether the goal still moves on its own. */
export function goalIsActive(g: Goal): boolean {
  return g.status === 'running' || g.status === 'verifying' || g.status === 'cancelling'
}

/** goalStatusLabel is the one-line state the banner and the cards show. */
export function goalStatusLabel(g: Goal): string {
  switch (g.status) {
    case 'draft':
      return '草稿'
    case 'validating':
      return '校验中'
    case 'ready':
      return '待开始'
    case 'running':
      return `第 ${g.round + 1} 轮`
    case 'verifying':
      return '复验中'
    case 'paused':
      return g.status_reason || '已暂停'
    case 'cancelling':
      return '正在停止'
    case 'achieved':
      return '已达成'
    case 'failed':
      return '未达成'
    case 'cancelled':
      return '已停止'
    default:
      return g.status
  }
}

/** forkGoal copies a goal into a new draft with a different condition. */
export function forkGoal(id: string, condition?: string): Promise<DraftView> {
  return getHost().api.post<DraftView>(
    `/goals/${encodeURIComponent(id)}/fork`,
    { condition },
    base(),
  )
}
