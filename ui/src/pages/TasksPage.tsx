// The tasks page: every long-running goal, grouped by whether it still moves.
//
// It is the P0 panel (design §B5): two sections, four states each, one row per
// goal with its owner agent, its round and the verdict of the last round. The
// page polls the same endpoints the conversation banner uses — no SSE in P0.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CirclePause, CirclePlay, Loader2, Target, XCircle } from 'lucide-react'

import type { PageContext } from '../contract'
import { setHost } from '../host'
import { Button } from '../agent/components/ui/button'
import {
  cancelGoal,
  goalIsActive,
  goalStatusLabel,
  listGoals,
  pauseGoal,
  resumeGoal,
  type Goal,
} from '../agent/lib/goalApi'

const POLL_MS = 5000

const ACTIVE_STATUSES = new Set(['draft', 'validating', 'ready', 'running', 'verifying', 'paused', 'cancelling'])

function splitGoals(goals: Goal[]): { active: Goal[]; finished: Goal[] } {
  const active: Goal[] = []
  const finished: Goal[] = []
  for (const g of goals) {
    if (ACTIVE_STATUSES.has(g.status)) {
      active.push(g)
    } else {
      finished.push(g)
    }
  }
  return { active, finished }
}

function Row({ goal, onAct, busy }: { goal: Goal; onAct: (fn: (id: string) => Promise<unknown>, id: string) => void; busy: boolean }) {
  const { t } = useTranslation()
  const pausable = goal.status === 'running' || goal.status === 'verifying'
  const resumable = goal.status === 'paused'
  const cancellable = goalIsActive(goal)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-sm last:border-b-0" data-task-row={goal.status}>
      <Target className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate" title={goal.condition}>
        {goal.title || goal.condition}
      </span>
      <span className="text-xs text-muted-foreground">{goal.agent_id}</span>
      <span className="rounded-full border px-2 py-0.5 text-[11px]">{goalStatusLabel(goal)}</span>
      <span className="text-xs text-muted-foreground">
        {goal.round}/{goal.max_rounds}
      </span>
      {goal.last_verdict ? <span className="text-xs">{goal.last_verdict}</span> : null}
      <span className="flex items-center gap-1">
        {pausable ? (
          <Button size="sm" variant="ghost" className="h-6 px-1.5" disabled={busy} onClick={() => onAct(pauseGoal, goal.id)}>
            <CirclePause className="size-3.5" />
            {t('goal.banner.pause', { defaultValue: '暂停' })}
          </Button>
        ) : null}
        {resumable ? (
          <Button size="sm" variant="ghost" className="h-6 px-1.5" disabled={busy} onClick={() => onAct(resumeGoal, goal.id)}>
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
            onClick={() => onAct(cancelGoal, goal.id)}
          >
            <XCircle className="size-3.5" />
            {t('goal.banner.cancel', { defaultValue: '叫停' })}
          </Button>
        ) : null}
      </span>
    </li>
  )
}

function Section({ title, goals, onAct, busy }: { title: string; goals: Goal[]; onAct: (fn: (id: string) => Promise<unknown>, id: string) => void; busy: boolean }) {
  const { t } = useTranslation()
  return (
    <section className="rounded-lg border" data-task-section={title}>
      <header className="flex items-center justify-between border-b bg-muted/30 px-3 py-2 text-sm font-medium">
        <span>{title}</span>
        <span className="text-xs text-muted-foreground">{goals.length}</span>
      </header>
      {goals.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {t('goal.tasks.empty', { defaultValue: '这里还没有目标' })}
        </p>
      ) : (
        <ul>
          {goals.map((g) => (
            <Row key={g.id} goal={g} onAct={onAct} busy={busy} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function TasksPage({ ctx }: { ctx: PageContext }) {
  setHost(ctx)
  const { t } = useTranslation()
  const { ui } = ctx
  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await listGoals()
      setGoals(res.goals ?? [])
    } catch {
      setGoals((prev) => prev)
    }
  }, [])

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

  const act = useCallback(
    async (fn: (id: string) => Promise<unknown>, id: string) => {
      setBusy(true)
      try {
        await fn(id)
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const { active, finished } = useMemo(() => splitGoals(goals ?? []), [goals])
  const PageHeader = ui.PageHeader

  return (
    <div className="flex flex-col gap-4" data-tasks-page="">
      <PageHeader
        title={t('goal.tasks.title', { defaultValue: '长程目标' })}
        subtitle={t('goal.tasks.subtitle', { defaultValue: '正在跑的和已经结束的目标；每行归属一个智能体' })}
      />
      {goals === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('common.loading', { defaultValue: '加载中…' })}
        </div>
      ) : (
        <>
          <Section
            title={t('goal.tasks.active', { defaultValue: '进行中' })}
            goals={active}
            onAct={act}
            busy={busy}
          />
          <Section
            title={t('goal.tasks.finished', { defaultValue: '已结束' })}
            goals={finished}
            onAct={act}
            busy={busy}
          />
        </>
      )}
    </div>
  )
}
