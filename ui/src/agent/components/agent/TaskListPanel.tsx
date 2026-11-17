import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { Badge } from '../ui/badge'
import { EmptyState } from '../ui/empty-state'
import { readTextFile, type SessionSummary } from '../../lib/api'
import {
  describeSchedule,
  formatDuration,
  formatRunTime,
  jobStatus,
  parseCronStore,
  taskChatID,
  taskModeOf,
  type CronJob,
  type JobStatus,
} from '../../lib/cronTasks'
import { useAgentResource } from '../../workbench/useAgentResource'
import { cn } from '../../lib/utils'

/** Where the scheduler keeps the agent's tasks, relative to the agent's home. */
const CRON_FILE_PATH = 'agent/cron.json'

/** The scheduler rewrites the file when a task fires, so a slow poll is enough
 * to keep "next run" and "last run" honest without hammering the tunnel. */
const TASKS_REFRESH_MS = 15_000

function statusTone(status: JobStatus): string {
  switch (status) {
    case 'ok':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'error':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}

// TaskList shows the agent's scheduled tasks. It is read-only by design: the
// file belongs to the scheduler, which rewrites it on every change, so editing
// it from the portal would be silently reverted. Tasks are created, changed and
// removed by the agent in a conversation.
export function TaskList({
  agentId,
  rows,
  onOpenSession,
}: {
  agentId: string | null
  rows: SessionSummary[]
  onOpenSession: (sessionId: string) => void
}) {
  const { t, i18n } = useTranslation()

  const fetchTasks = useCallback(
    async (id: string) => parseCronStore(await readTextFile(id, CRON_FILE_PATH)),
    [],
  )
  const { data, error, loading, refresh } = useAgentResource<CronJob[]>(agentId, fetchTasks)

  useEffect(() => {
    if (!agentId) {
      return
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }, TASKS_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [agentId, refresh])

  const taskModeLabel = (job: CronJob): string => {
    switch (taskModeOf(job)) {
      case 'plan':
        return t('agent.tasks.modePlan')
      case 'build':
        return t('agent.tasks.modeBuild')
      default:
        return t('agent.tasks.modeDefault')
    }
  }

  const scheduleLabel = (job: CronJob): string => {
    const schedule = describeSchedule(job.schedule)
    switch (schedule.kind) {
      case 'every':
        return t('agent.tasks.scheduleEvery', { value: formatDuration(schedule.everyMs) })
      case 'cron':
        return t('agent.tasks.scheduleCron', { expr: schedule.expr })
      case 'at':
        return t('agent.tasks.scheduleAt', { time: formatRunTime(schedule.atMs, i18n.language) })
      default:
        return t('agent.tasks.scheduleUnknown')
    }
  }

  if (!agentId) {
    return <p className="p-2 text-sm text-muted-foreground">{t('agent.selectAgentFirst')}</p>
  }
  if (loading && !data) {
    return (
      <div className="p-2">
        <Spinner className="h-4 w-4" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-2">
        <p className="text-sm text-muted-foreground">{t('agent.tasks.loadFailed')}</p>
        <p className="mt-1 break-all text-xs text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={refresh}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  const tasks = data ?? []
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title={t('agent.tasks.emptyTitle')}
        description={t('agent.tasks.emptyHint')}
        className="py-6"
      />
    )
  }

  return (
    <div data-tasks-panel>
      {tasks.map((job, index) => {
        const key = taskChatID(job)
        const run = key ? rows.find((row) => row.chat_id === key) : undefined
        const status = jobStatus(job.state)
        const next = formatRunTime(job.state?.nextRunAtMs, i18n.language)
        const last = formatRunTime(job.state?.lastRunAtMs, i18n.language)
        return (
          <button
            type="button"
            key={job.id ?? `task-${index}`}
            data-task-id={job.id ?? ''}
            disabled={!run}
            onClick={() => run && onOpenSession(run.id)}
            className={cn(
              'mb-1 flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors',
              run ? 'hover:bg-accent' : 'cursor-default',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{job.name || job.id}</span>
              {job.enabled === false ? (
                <Badge variant="secondary" className="shrink-0 px-1 text-[10px]">
                  {t('agent.tasks.disabled')}
                </Badge>
              ) : null}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {scheduleLabel(job)} · {t('agent.tasks.mode', { value: taskModeLabel(job) })}
            </span>
            <span className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              <span>{t('agent.tasks.next', { time: next || t('agent.tasks.never') })}</span>
              <span className={cn(statusTone(status))}>
                {t('agent.tasks.last', { time: last || t('agent.tasks.never') })}
              </span>
              {!run ? <span>{t('agent.tasks.noRuns')}</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
