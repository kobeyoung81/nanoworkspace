// The execution-status control (product §5.6).
//
// One position, two subjects: with a goal it is the goal's state; with only a
// plan it is the plan's state; with neither it is absent. It replaces the old
// "待办 n/m" counter — progress must not be recorded by the party being judged.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CirclePause, ClipboardList, ListChecks, Target, Wrench } from 'lucide-react'

import { cn } from '../../lib/utils'
import { minutesSince } from '../../lib/goalTime'
import { Button } from '../ui/button'
import { listGoalsForSession, pauseGoal, pickGoalForSession, resumeGoal, type Goal } from '../../lib/goalApi'

const POLL_MS = 5000

type Props = {
  sessionKey: string
  /** Plan state for the moment before a goal exists (product §5.6 form B). */
  planReady?: boolean
  planBusy?: boolean
  /** How many steps the plan has, for "计划 · 7 步". 0 hides the count. */
  planSteps?: number
  /** The transcript, so form B can name the last thing the agent did. */
  messages?: ReadonlyArray<{ role: string; content?: string }>
  /** Reports whether a goal exists, so the caller can hide the todo counter. */
  onActiveChange?: (active: boolean) => void
  /** Opens the tasks panel (product §5.6, form A). */
  onOpenTasks?: () => void
}

/** lastStep is the one-line "上一步" the plan form shows. */
function lastStep(messages: ReadonlyArray<{ role: string; content?: string }> | undefined): string {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const message = messages?.[i]
    if (message?.role !== 'assistant') continue
    // Assistant content is markdown; the first non-empty line is the sentence the
    // reader would recognise.
    const line = (message.content ?? '')
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
      .find((l) => l !== '')
    if (line) return line.length > 24 ? `${line.slice(0, 24)}…` : line
  }
  return ''
}

export function GoalStatusControl({
  sessionKey,
  planReady,
  planBusy,
  planSteps,
  messages,
  onActiveChange,
  onOpenTasks,
}: Props) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState<Goal | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!sessionKey.trim()) {
      // No conversation key yet: there cannot be a goal, and asking would return
      // every goal the user owns.
      setGoal(null)
      return
    }
    try {
      const res = await listGoalsForSession(sessionKey)
      setGoal(pickGoalForSession(res.goals ?? [], sessionKey))
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

  // A draft is not a goal yet: it is a card the reader is still filling in. Only a
  // started goal takes the composer over (product §5.2 / §5.6) — treating a
  // leftover draft as "running" kept build/plan switched off until it was deleted
  // by hand in the tasks panel.
  const started = goal !== null

  useEffect(() => {
    onActiveChange?.(started)
  }, [started, onActiveChange])

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

  if (goal && started) {
    const pct = goal.max_rounds > 0 ? Math.min(100, Math.round(((goal.round + 1) / goal.max_rounds) * 100)) : 0
    const running = goal.status === 'running' || goal.status === 'verifying'
    const minutes = minutesSince(goal.started_at ?? goal.updated_at)
    return (
      <div className="flex items-center gap-2 text-[11px]" data-goal-status="goal">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Target className="size-3.5 text-primary" />
          {t('goal.status.title', { defaultValue: '◎ 长程目标' })}
        </span>
        <span className="text-muted-foreground" data-goal-status-rounds>
          {t('goal.status.minutes', {
            defaultValue: '第 {{round}}/{{max}} 轮 · {{minutes}} 分钟',
            round: goal.round + 1,
            max: goal.max_rounds,
            minutes,
          })}
        </span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
        {goal.last_verdict && goal.last_verdict !== 'met' ? (
          <span className="truncate text-amber-600">
            {t('goal.status.verdict', { defaultValue: '未达成：{{reason}}', reason: goal.last_reason || goal.last_verdict })}
          </span>
        ) : null}
        {(planSteps ?? 0) > 0 ? (
          <span className="hidden truncate text-muted-foreground lg:inline" data-goal-status-planref>
            {t('goal.status.planRef', { defaultValue: '计划 · {{n}} 步（参考）', n: planSteps })}
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
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5"
            onClick={() => onOpenTasks?.()}
            title={t('goal.status.openTasks', { defaultValue: '打开任务面板' })}
            aria-label={t('goal.status.openTasks', { defaultValue: '打开任务面板' })}
            data-goal-open-tasks
          >
            <ListChecks className="size-3" />
            <span className="hidden lg:inline">{t('goal.status.openTasks', { defaultValue: '打开任务面板' })}</span>
          </Button>
        </span>
      </div>
    )
  }

  if (planReady || planBusy) {
    const step = lastStep(messages)
    return (
      <div className="flex items-center gap-2 text-[11px]" data-goal-status="plan">
        <ClipboardList className="size-3.5 text-muted-foreground" />
        <span className="font-medium" data-goal-status-plan>
          {t('goal.status.planSteps', {
            defaultValue: '📋 计划 · {{n}} 步',
            n: planSteps ?? 0,
          })}
        </span>
        <span className={cn('text-muted-foreground')}>
          {planBusy
            ? t('goal.status.planRunning', { defaultValue: '状态：执行中' })
            : t('goal.status.planReady', { defaultValue: '状态：就绪' })}
        </span>
        <span className="hidden min-w-0 truncate text-muted-foreground lg:inline" data-goal-status-laststep>
          {t('goal.status.lastStep', { defaultValue: '上一步：{{step}}', step: step || '—' })}
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
