// The Tasks & Goals panel: the workbench's left dock (user's call, 2026-11-21).
//
// It replaces the top-level page the design drafted: the question "what is
// running across my agents" belongs beside the conversation, not on a screen of
// its own. Two sections, four filters, one row per item with its owner, and the
// actions that have to be reachable without leaving the workbench.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CirclePause, CirclePlay, Loader2, MessageSquare, Target, XCircle } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  cancelGoal,
  goalIsActive,
  goalStatusLabel,
  listGoals,
  pauseGoal,
  resumeGoal,
  type Goal,
} from '../../lib/goalApi'

const POLL_MS = 5000

/** The four filters the panel offers (product §5.5). */
type Filter = 'running' | 'queued' | 'attention' | 'finished'

const FILTER_STATUSES: Record<Filter, string[]> = {
  running: ['running', 'verifying'],
  queued: ['ready', 'validating', 'draft'],
  attention: ['paused', 'cancelling'],
  finished: ['achieved', 'failed', 'cancelled'],
}

function matches(g: Goal, filter: Filter): boolean {
  return FILTER_STATUSES[filter].includes(g.status)
}

function Row({
  goal,
  onAct,
  onOpen,
  busy,
}: {
  goal: Goal
  onAct: (fn: (id: string) => Promise<unknown>, id: string) => void
  onOpen: (goal: Goal) => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const pausable = goal.status === 'running' || goal.status === 'verifying'
  const resumable = goal.status === 'paused'
  const cancellable = goalIsActive(goal)
  return (
    <li className="border-b px-2.5 py-2 text-xs last:border-b-0" data-task-row={goal.status}>
      <div className="flex items-start gap-1.5">
        <Target className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
          title={goal.condition}
          onClick={() => onOpen(goal)}
          data-task-open
        >
          {goal.title || goal.condition}
        </button>
        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]">{goalStatusLabel(goal)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="truncate">{goal.agent_id}</span>
        <span className="shrink-0">
          {goal.round}/{goal.max_rounds}
        </span>
        {goal.last_verdict ? <span className="shrink-0">{goal.last_verdict}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {pausable ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1"
              disabled={busy}
              onClick={() => onAct(pauseGoal, goal.id)}
              data-task-action="pause"
            >
              <CirclePause className="size-3" />
            </Button>
          ) : null}
          {resumable ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1"
              disabled={busy}
              onClick={() => onAct(resumeGoal, goal.id)}
              data-task-action="resume"
            >
              <CirclePlay className="size-3" />
            </Button>
          ) : null}
          {cancellable ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => onAct(cancelGoal, goal.id)}
              data-task-action="cancel"
            >
              <XCircle className="size-3" />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1"
            onClick={() => onOpen(goal)}
            title={t('goal.tasks.open', { defaultValue: '打开对话' })}
          >
            <MessageSquare className="size-3" />
          </Button>
        </span>
      </div>
    </li>
  )
}

// The workbench mounts a panel with its own context and no props, so the panel
// reads what it needs from the workbench itself.
export function TasksPanel(_props?: { ctx?: unknown; onOpenGoal?: (goal: Goal) => void }) {
  const onOpenGoal = _props?.onOpenGoal
  const { t } = useTranslation()
  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [filter, setFilter] = useState<Filter>('running')
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

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { running: 0, queued: 0, attention: 0, finished: 0 }
    for (const g of goals ?? []) {
      for (const key of Object.keys(out) as Filter[]) {
        if (matches(g, key)) out[key]++
      }
    }
    return out
  }, [goals])

  const visible = useMemo(() => (goals ?? []).filter((g) => matches(g, filter)), [goals, filter])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card" data-tasks-panel>
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5" data-task-filters>
        {(Object.keys(FILTER_STATUSES) as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            data-task-filter={key}
            aria-pressed={filter === key}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px]',
              filter === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {t(`panel.goals.filter.${key}`, { defaultValue: key })}
            {counts[key] > 0 ? <span className="ml-1 opacity-80">{counts[key]}</span> : null}
          </button>
        ))}
      </div>
      {goals === null ? (
        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('common.loading', { defaultValue: '加载中…' })}
        </div>
      ) : visible.length === 0 ? (
        <p className="p-3 text-[11px] text-muted-foreground" data-task-empty>
          {t('panel.goals.empty', {
            defaultValue: '还没有定时任务和目标。在对话里点「指令 → 设定长程目标」开始。',
          })}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((g) => (
            <Row key={g.id} goal={g} onAct={act} onOpen={(goal) => onOpenGoal?.(goal)} busy={busy} />
          ))}
        </ul>
      )}
    </div>
  )
}
