// The execution-status control (product §5.6).
//
// One position, two subjects: with a goal it is the goal's state; with only a
// plan it is the plan's state; with neither it is absent. It replaces the old
// "待办 n/m" counter — progress must not be recorded by the party being judged.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CirclePause, ClipboardList, Target, Wrench } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { goalIsActive, listGoalsForSession, pauseGoal, resumeGoal, type Goal } from '../../lib/goalApi'

const POLL_MS = 5000

type Props = {
  sessionKey: string
  /** Plan state for the moment before a goal exists (product §5.6 form B). */
  planReady?: boolean
  planBusy?: boolean
  /** Reports whether a goal exists, so the caller can hide the todo counter. */
  onActiveChange?: (active: boolean) => void
}

export function GoalStatusControl({ sessionKey, planReady, planBusy, onActiveChange }: Props) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState<Goal | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await listGoalsForSession(sessionKey)
      const active = (res.goals ?? []).find(goalIsActive) ?? (res.goals ?? [])[0] ?? null
      setGoal(active)
    } catch {
      setGoal((prev) => prev)
    }
  }, [sessionKey])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (!cancelled) await refresh()
    }
    void tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    onActiveChange?.(!!goal)
  }, [goal, onActiveChange])

  const act = async (fn: (id: string) => Promise<unknown>) => {
    if (!goal) return
    setBusy(true)
    try {
      await fn(goal.id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (goal) {
    const pct = goal.max_rounds > 0 ? Math.min(100, Math.round(((goal.round + 1) / goal.max_rounds) * 100)) : 0
    const running = goal.status === 'running' || goal.status === 'verifying'
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-[11px]" data-goal-status="goal">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Target className="size-3.5 text-primary" />
          {t('goal.status.title', { defaultValue: '◎ 长程目标' })}
        </span>
        <span className="text-muted-foreground">
          {t('goal.status.rounds', {
            defaultValue: '第 {{round}}/{{max}} 轮',
            round: goal.round + 1,
            max: goal.max_rounds,
          })}
        </span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
        {goal.last_verdict && goal.last_verdict !== 'met' ? (
          <span className="truncate text-amber-600">
            {t('goal.status.verdict', { defaultValue: '未达成：{{reason}}', reason: goal.last_reason || goal.last_verdict })}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {running ? (
            <Button size="sm" variant="ghost" className="h-5 px-1.5" disabled={busy} onClick={() => act(pauseGoal)}>
              <CirclePause className="size-3" />
              {t('goal.banner.pause', { defaultValue: '暂停' })}
            </Button>
          ) : goal.status === 'paused' ? (
            <Button size="sm" variant="ghost" className="h-5 px-1.5" disabled={busy} onClick={() => act(resumeGoal)}>
              {t('goal.banner.resume', { defaultValue: '继续' })}
            </Button>
          ) : null}
        </span>
      </div>
    )
  }

  if (planReady || planBusy) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-[11px]" data-goal-status="plan">
        <ClipboardList className="size-3.5 text-muted-foreground" />
        <span className="font-medium">
          {t('goal.status.plan', { defaultValue: '📋 计划' })}
        </span>
        <span className={cn('text-muted-foreground')}>
          {planBusy
            ? t('goal.status.planRunning', { defaultValue: '状态：执行中' })
            : t('goal.status.planReady', { defaultValue: '状态：就绪' })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-5 px-1.5"
          onClick={() => window.dispatchEvent(new CustomEvent('goal:create'))}
          data-goal-status-create
        >
          <Wrench className="size-3" />
          {t('goal.status.create', { defaultValue: '生成长程目标' })}
        </Button>
      </div>
    )
  }
  return null
}
