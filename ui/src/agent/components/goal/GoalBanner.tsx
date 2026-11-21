// The goal banner: the conversation's long-running goal, one line plus controls.
//
// It polls the same endpoints the panel uses (design §B4): 5 seconds, no SSE in
// P0. The banner is the answer to "why is this conversation busy without me
// typing?" — so it always shows the state, the round and the last verdict, and it
// carries the three controls that have to be reachable without leaving the chat.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronUp, CirclePause, CirclePlay, Target, XCircle } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { GoalEndCard } from './GoalEndCard'
import {
  cancelGoal,
  goalIsActive,
  forkGoal,
  listGoalsForSession,
  pauseGoal,
  resumeGoal,
  type Goal,
} from '../../lib/goalApi'

const POLL_MS = 5000

type Props = {
  sessionKey: string
}

/** GoalBanner shows the newest goal of this conversation. */
export function GoalBanner({ sessionKey }: Props) {
  const { t } = useTranslation()
  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await listGoalsForSession(sessionKey)
      setGoals(res.goals ?? [])
    } catch {
      // A banner that cannot be read is better absent than red: the poller
      // retries, and a stopped workspace must not paint the chat with errors.
      setGoals((prev) => prev)
    }
  }, [sessionKey])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await refresh()
    }
    void tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [refresh])

  const goal = useMemo(() => {
    if (!goals || goals.length === 0) return null
    // The banner speaks for what is moving; a finished goal stays visible only
    // while it is the newest thing in the conversation.
    return goals.find(goalIsActive) ?? goals[0]
  }, [goals])

  if (!goal || goal.status === 'draft') {
    return null
  }

  const minutes = goal.started_at
    ? Math.max(0, Math.round((Date.now() - new Date(goal.started_at).getTime()) / 60000))
    : 0

  const act = async (fn: (id: string) => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn(goal.id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const pausable = goal.status === 'running' || goal.status === 'verifying'
  const resumable = goal.status === 'paused'
  const cancellable = goalIsActive(goal)

  const finished = goal.status === 'achieved' || goal.status === 'failed' || goal.status === 'cancelled'
  const parked = goal.status === 'paused'

  return (
    <div className="border-b bg-muted/30 px-3 py-1.5 text-xs" data-goal-banner={goal.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Target className="size-3.5 shrink-0 text-primary" />
        {/* The four states and their wording are product §5.9; the icons are the
            placeholders from that table. */}
        <span className="font-medium" data-goal-banner-status>
          {goal.status === 'running' || goal.status === 'verifying'
            ? t('goal.bar.running', {
                defaultValue: '目标进行中 · 第 {{round}}/{{max}} 轮 · {{minutes}} 分钟',
                round: goal.round + 1,
                max: goal.max_rounds,
                minutes,
              })
            : goal.status === 'paused'
              ? t('goal.bar.paused', { defaultValue: '已暂停 · {{reason}}', reason: goal.status_reason || '—' })
              : goal.status === 'cancelling'
                ? t('goal.bar.cancelling', { defaultValue: '正在停止…' })
                : goal.status === 'achieved'
                  ? t('goal.bar.achieved', {
                      defaultValue: '已达成 · {{round}} 轮 · {{minutes}} 分钟',
                      round: goal.result?.rounds ?? goal.round,
                      minutes: goal.result?.minutes ?? minutes,
                    })
                  : goal.status === 'failed'
                    ? t('goal.bar.failed', { defaultValue: '未达成 · {{reason}}', reason: goal.status_reason || '—' })
                    : t('goal.bar.cancelled', {
                        defaultValue: '已叫停 · 完成 {{round}} 轮',
                        round: goal.round,
                      })}
        </span>
        <span className="truncate text-muted-foreground" title={goal.condition}>
          {goal.title || goal.condition}
        </span>
        {goal.last_verdict ? (
          <span
            className={cn(
              'rounded-full border px-1.5 py-0.5 text-[10px]',
              goal.last_verdict === 'met'
                ? 'border-emerald-500/40 text-emerald-600'
                : goal.last_verdict === 'impossible'
                  ? 'border-destructive/40 text-destructive'
                  : 'border-amber-500/40 text-amber-600',
            )}
          >
            {goal.last_verdict}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {pausable ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              disabled={busy}
              onClick={() => act(pauseGoal)}
              data-goal-action="pause"
            >
              <CirclePause className="size-3.5" />
              {t('goal.banner.pause', { defaultValue: '暂停' })}
            </Button>
          ) : null}
          {resumable ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              disabled={busy}
              onClick={() => act(resumeGoal)}
              data-goal-action="resume"
            >
              <CirclePlay className="size-3.5" />
              {t('goal.banner.resume', { defaultValue: '继续' })}
            </Button>
          ) : null}
          {cancellable ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => act(cancelGoal)}
              data-goal-action="cancel"
            >
              <XCircle className="size-3.5" />
              {t('goal.banner.cancel', { defaultValue: '叫停' })}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>
        </span>
      </div>

      {finished || parked ? (
        <div className="-mx-3 -mb-1.5">
          <GoalEndCard
            goal={goal}
            onResume={() => void act(resumeGoal)}
            onFork={() => void act(async (id) => forkGoal(id))}
            onExpandRounds={() => setOpen(true)}
          />
        </div>
      ) : null}

      {open ? (
        <div className="mt-1.5 space-y-1 border-t pt-1.5" data-goal-rounds>
          {goal.status_reason ? <div className="text-muted-foreground">{goal.status_reason}</div> : null}
          {(goal.rounds ?? []).length === 0 ? (
            <div className="text-muted-foreground">{t('goal.banner.noRounds', { defaultValue: '还没有轮次' })}</div>
          ) : (
            <ol className="space-y-0.5">
              {(goal.rounds ?? []).slice(-8).map((r) => (
                <li key={`${r.n}-${r.at}`} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-muted-foreground">#{r.n + 1}</span>
                  <span
                    className={cn(
                      r.verdict === 'met' ? 'text-emerald-600' : r.verdict === 'impossible' ? 'text-destructive' : 'text-amber-600',
                    )}
                  >
                    {r.verdict}
                  </span>
                  {r.files ? <span className="text-muted-foreground">{r.files} 个文件</span> : null}
                </li>
              ))}
            </ol>
          )}
          {goal.result ? (
            <div className="flex items-start gap-1 text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>
                {goal.result.verdict} · {goal.result.reason} · {goal.result.rounds} 轮 / {goal.result.minutes} 分钟
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
