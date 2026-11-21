// The Tasks panel: the workbench's left dock.
//
// Two sections, top and bottom, with a draggable divider between them (user's
// call, 2026-11-21): long-running goals above, scheduled tasks below. The goal
// rows always show the actions that apply to their state — the "queued" rows used
// to show none at all, which is why they looked stuck.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CirclePause, CirclePlay, Clock, Loader2, MessageSquare, Target, Trash2, XCircle } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { HeightResizeHandle } from '../ui/resize-handle'
import { readState, writeState } from '../../lib/clientState'
import { useWorkbench } from '../../workbench/context'
import { GoalConfirmSheet, type ConfirmKind } from '../goal/GoalConfirmSheet'
import {
  cancelGoal,
  deleteGoal,
  goalIsActive,
  goalStatusLabel,
  listCronTasks,
  listGoals,
  pauseGoal,
  resumeGoal,
  type CronTask,
  type Goal,
} from '../../lib/goalApi'

const POLL_MS = 5000
const SPLIT_KEY = 'goalTasksSplit'
const SPLIT_DEFAULT = 260
const SPLIT_MIN = 140

type Filter = 'running' | 'queued' | 'attention' | 'finished'

const FILTER_STATUSES: Record<Filter, string[]> = {
  running: ['running', 'verifying'],
  queued: ['draft', 'validating', 'ready'],
  attention: ['paused', 'cancelling'],
  finished: ['achieved', 'failed', 'cancelled'],
}

function matches(g: Goal, filter: Filter): boolean {
  return FILTER_STATUSES[filter].includes(g.status)
}

/** ActionRow is the set of buttons a goal's state allows (always visible). */
function ActionRow({
  goal,
  busy,
  onAct,
  onDelete,
}: {
  goal: Goal
  busy: boolean
  onAct: (fn: (id: string) => Promise<unknown>, id: string) => void
  onDelete: (goal: Goal) => void
}) {
  const { t } = useTranslation()
  const running = goal.status === 'running' || goal.status === 'verifying'
  const paused = goal.status === 'paused'
  const cancellable = goalIsActive(goal) || goal.status === 'ready' || goal.status === 'draft' || goal.status === 'validating'

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {running ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          disabled={busy}
          onClick={() => onAct(pauseGoal, goal.id)}
          title={t('goal.banner.pause', { defaultValue: '暂停' })}
          aria-label={t('goal.banner.pause', { defaultValue: '暂停' })}
          data-task-action="pause"
        >
          <CirclePause className="size-3.5" />
        </Button>
      ) : null}
      {paused ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          disabled={busy}
          onClick={() => onAct(resumeGoal, goal.id)}
          title={t('goal.banner.resume', { defaultValue: '继续' })}
          aria-label={t('goal.banner.resume', { defaultValue: '继续' })}
          data-task-action="resume"
        >
          <CirclePlay className="size-3.5" />
        </Button>
      ) : null}
      {cancellable ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => onAct(cancelGoal, goal.id)}
          title={t('goal.banner.cancel', { defaultValue: '叫停' })}
          aria-label={t('goal.banner.cancel', { defaultValue: '叫停' })}
          data-task-action="cancel"
        >
          <XCircle className="size-3.5" />
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        disabled={busy}
        onClick={() => onDelete(goal)}
        title={t('goal.delete.action', { defaultValue: '删除' })}
        aria-label={t('goal.delete.action', { defaultValue: '删除' })}
        data-task-action="delete"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </span>
  )
}

function GoalRow({
  goal,
  onAct,
  onOpen,
  onDelete,
  busy,
}: {
  goal: Goal
  onAct: (fn: (id: string) => Promise<unknown>, id: string) => void
  onOpen: (goal: Goal) => void
  onDelete: (goal: Goal) => void
  busy: boolean
}) {
  const { t } = useTranslation()
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
          <ActionRow goal={goal} busy={busy} onAct={onAct} onDelete={onDelete} />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => onOpen(goal)}
            title={t('goal.tasks.open', { defaultValue: '打开对话' })}
            aria-label={t('goal.tasks.open', { defaultValue: '打开对话' })}
            data-task-action="open"
          >
            <MessageSquare className="size-3.5" />
          </Button>
        </span>
      </div>
    </li>
  )
}

export function TasksPanel(_props?: { ctx?: unknown }) {
  const { t } = useTranslation()
  const { selectedAgent, selectAgent, selectSession, sessionLists, ops } = useWorkbench()
  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [filter, setFilter] = useState<Filter>('running')
  const [busy, setBusy] = useState(false)
  const [cronTasks, setCronTasks] = useState<CronTask[]>([])
  const [confirming, setConfirming] = useState<{ kind: ConfirmKind; id: string } | null>(null)
  const [split, setSplit] = useState<number>(() =>
    readState<number>('layout', SPLIT_KEY, (raw) => (typeof raw === 'number' ? raw : null), SPLIT_DEFAULT),
  )
  const rootRef = useRef<HTMLDivElement>(null)

  const persistSplit = useCallback((next: number) => {
    setSplit(next)
    writeState('layout', SPLIT_KEY, next)
    void next
  }, [])

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

  useEffect(() => {
    if (!selectedAgent) {
      setCronTasks([])
      return
    }
    let cancelled = false
    void listCronTasks(selectedAgent)
      .then((res) => {
        if (!cancelled) setCronTasks(res.tasks ?? [])
      })
      .catch(() => {
        if (!cancelled) setCronTasks([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedAgent])

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

  const openGoal = useCallback(
    (goal: Goal) => {
      selectAgent(goal.agent_id)
      const entry = sessionLists[goal.agent_id]
      const hit =
        entry?.rows.find((row) => row.chat_id === goal.chat_id) ??
        entry?.rows.find((row) => row.id.startsWith(goal.session_key))
      if (hit) selectSession(hit.id)
      ops.openPanel('chat')
    },
    [selectAgent, selectSession, sessionLists, ops],
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
  const maxSplit = Math.max(SPLIT_MIN + 40, (rootRef.current?.clientHeight ?? 600) - 160)

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-card" data-tasks-panel>
      <section
        className="flex min-h-0 flex-col"
        style={{ height: split }}
        data-tasks-section="goals"
      >
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
          <ul className="min-h-0 flex-1 overflow-y-auto" data-tasks-goals>
            {visible.map((g) => (
              <GoalRow
                key={g.id}
                goal={g}
                onAct={act}
                onOpen={openGoal}
                onDelete={(goal) => setConfirming({ kind: 'delete', id: goal.id })}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </section>

      <HeightResizeHandle
        value={split}
        min={SPLIT_MIN}
        max={maxSplit}
        expandBy="down"
        onChange={persistSplit}
        label={t('panel.goals.resizeHandle', { defaultValue: '调整目标与定时任务的高度' })}
      />

      <section className="flex min-h-0 flex-1 flex-col" data-tasks-section="cron">
        <div className="flex items-center gap-1 border-b px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Clock className="size-3" />
          <span className="font-medium">{t('panel.goals.section.tasks', { defaultValue: '定时任务' })}</span>
          <span className="ml-auto">{cronTasks.length}</span>
        </div>
        {cronTasks.length === 0 ? (
          <p className="p-3 text-[11px] text-muted-foreground">
            {t('panel.goals.cronEmpty', { defaultValue: '这个智能体还没有定时任务' })}
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {cronTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs" data-cron-task={task.id}>
                <span className={cn('size-1.5 shrink-0 rounded-full', task.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                <span className="min-w-0 flex-1 truncate">{task.name || task.id}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{task.schedule}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="px-2.5 pb-1.5 text-[10px] text-muted-foreground">
          {t('panel.goals.cronReadOnly', { defaultValue: '启停在对话里用 cron 工具完成，面板只读' })}
        </p>
      </section>

      {confirming ? (
        <GoalConfirmSheet
          kind={confirming.kind}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming
            setConfirming(null)
            void act(deleteGoal, target.id)
          }}
        />
      ) : null}
    </div>
  )
}
