// View model for the scheduled tasks stored in the agent's `agent/cron.json`.
//
// The file belongs to the agent's scheduler: the portal only reads it (a
// portal-side write would be overwritten by the next scheduler save) and shows
// what it finds. Every job fires a turn in a conversation of its own, named by
// payload.chatId — that is how a run is found in the session list.
import type { SessionSummary } from './api'
import { segmentVersionOf } from '../conversations/sessionLists'

export type CronScheduleKind = 'at' | 'every' | 'cron'

export type CronSchedule = {
  kind?: CronScheduleKind | string
  atMs?: number
  everyMs?: number
  expr?: string
}

export type CronJobState = {
  nextRunAtMs?: number
  lastRunAtMs?: number
  lastStatus?: string
  lastError?: string
}

export type CronJob = {
  id?: string
  name?: string
  enabled?: boolean
  schedule?: CronSchedule
  payload?: { message?: string; channel?: string; chatId?: string; mode?: string }
  state?: CronJobState
}

/** What the schedule means, before any locale is applied. */
export type ScheduleDescription =
  | { kind: 'every'; everyMs: number }
  | { kind: 'cron'; expr: string }
  | { kind: 'at'; atMs: number }
  | { kind: 'unknown' }

export type JobStatus = 'ok' | 'error' | 'never'

// parseCronStore reads the scheduler's store. A missing, empty or malformed
// file is an empty list rather than an error: the file only exists once the
// agent has scheduled something, and a half-written file must not blank the
// panel.
export function parseCronStore(text: string | null | undefined): CronJob[] {
  if (!text) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') {
    return []
  }
  const jobs = (parsed as { jobs?: unknown }).jobs
  if (!Array.isArray(jobs)) {
    return []
  }
  return jobs.filter((job): job is CronJob => !!job && typeof job === 'object')
}

export function describeSchedule(schedule: CronSchedule | undefined): ScheduleDescription {
  if (!schedule) {
    return { kind: 'unknown' }
  }
  switch (schedule.kind) {
    case 'every':
      if (typeof schedule.everyMs === 'number' && schedule.everyMs > 0) {
        return { kind: 'every', everyMs: schedule.everyMs }
      }
      return { kind: 'unknown' }
    case 'cron':
      if (schedule.expr) {
        return { kind: 'cron', expr: schedule.expr }
      }
      return { kind: 'unknown' }
    case 'at':
      if (typeof schedule.atMs === 'number') {
        return { kind: 'at', atMs: schedule.atMs }
      }
      return { kind: 'unknown' }
    default:
      return { kind: 'unknown' }
  }
}

// formatDuration renders an interval the way it is shown in the list.
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`
  }
  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)}h`
  }
  return `${Math.round(seconds / 86400)}d`
}

// taskChatID is the conversation a task runs in. Without it the job cannot be
// matched to a conversation, so the row stays unlinked instead of guessing.
export function taskChatID(job: CronJob): string | null {
  const chatID = job.payload?.chatId
  return chatID ? chatID : null
}

// taskModeOf returns the mode a task runs in by its own configuration ("" when
// it follows the agent/platform setting).
export function taskModeOf(job: CronJob): string {
  const mode = job.payload?.mode
  return mode === 'build' || mode === 'plan' ? mode : ''
}

// pickRunSession finds the conversation of one task in an agent's session rows:
// same chat id, newest version (a compaction versions the conversation, and the
// sidebar only ever shows the newest segment).
export function pickRunSession(rows: SessionSummary[], chatID: string): SessionSummary | null {
  let best: SessionSummary | null = null
  for (const row of rows) {
    if (row.chat_id !== chatID) {
      continue
    }
    if (!best || segmentVersionOf(row.id) > segmentVersionOf(best.id)) {
      best = row
    }
  }
  return best
}

export function jobStatus(state: CronJobState | undefined): JobStatus {
  if (!state?.lastRunAtMs) {
    return 'never'
  }
  return state.lastStatus === 'error' ? 'error' : 'ok'
}

// nextRunLabel formats a run timestamp; '' means "not scheduled".
export function formatRunTime(ms: number | undefined, locale: string): string {
  if (typeof ms !== 'number' || ms <= 0) {
    return ''
  }
  return new Date(ms).toLocaleString(locale)
}
