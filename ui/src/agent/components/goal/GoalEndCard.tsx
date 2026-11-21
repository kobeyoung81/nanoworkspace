// The ending card: five outcomes, each with the two actions product §5.4 gives.
//
// It only appears once a goal has stopped for good (achieved, impossible,
// cancelled) or is parked (stuck, over budget). "Only one ending has no
// continue" is the product rule: everything except impossible can move again.

import { useTranslation } from 'react-i18next'
import { CheckCircle2, CirclePause, XCircle } from 'lucide-react'

import { Button } from '../ui/button'
import { getHost } from '../../../host'
import { updateBudget, type Goal } from '../../lib/goalApi'

/** goal:create asks the composer to open the creation flow (see AgentPage). */
export const GOAL_CREATE_EVENT = 'goal:create'

type Props = {
  goal: Goal
  onResume: () => void
  onFork: () => void
  onExpandRounds: () => void
}

export function GoalEndCard({ goal, onResume, onFork, onExpandRounds }: Props) {
  const { t } = useTranslation()
  const openFiles = () => {
    const host = getHost()
    host.navigate(`/files?agent=${encodeURIComponent(goal.agent_id)}`)
  }
  const createAnother = () => {
    window.dispatchEvent(new CustomEvent(GOAL_CREATE_EVENT))
  }
  const addBudget = async () => {
    await updateBudget(goal.id, (goal.max_rounds || 40) + 20, (goal.max_minutes || 180) + 60)
    onResume()
  }

  // The outcome decides the icon, the title and the two buttons.
  const outcome: 'achieved' | 'impossible' | 'stuck' | 'budget' | 'cancelled' =
    goal.status === 'achieved'
      ? 'achieved'
      : goal.status === 'failed'
        ? 'impossible'
        : goal.status === 'cancelled'
          ? 'cancelled'
          : goal.pause_reason === 'budget'
            ? 'budget'
            : 'stuck'

  const titles: Record<typeof outcome, string> = {
    achieved: t('goal.end.achieved', {
      defaultValue: '目标达成 · {{round}} 轮 / {{minutes}} 分钟',
      round: goal.result?.rounds ?? goal.round,
      minutes: goal.result?.minutes ?? 0,
    }),
    impossible: t('goal.end.impossible', {
      defaultValue: '做不到：{{reason}}',
      reason: goal.status_reason || '—',
    }),
    stuck: t('goal.end.stuck', {
      defaultValue: '卡住了：连续 {{n}} 轮没有实质进展',
      n: goal.no_progress_rounds ?? 3,
    }),
    budget: t('goal.end.budget', { defaultValue: '已到 {{limit}} 轮上限', limit: goal.max_rounds }),
    cancelled: t('goal.end.cancelled', {
      defaultValue: '已叫停 · 完成 {{round}} 轮',
      round: goal.round,
    }),
  }

  return (
    <div className="border-b bg-muted/40 px-3 py-2 text-xs" data-goal-end={outcome}>
      <div className="flex items-start gap-2">
        {outcome === 'achieved' ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        ) : outcome === 'impossible' ? (
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <CirclePause className="mt-0.5 size-4 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{titles[outcome]}</p>
          {goal.result?.reason ? (
            <p className="mt-0.5 text-muted-foreground">{goal.result.reason}</p>
          ) : goal.status_reason ? (
            <p className="mt-0.5 text-muted-foreground">{goal.status_reason}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {outcome === 'achieved' ? (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2" onClick={openFiles} data-goal-end-action="diff">
                {t('goal.end.viewChanges', { defaultValue: '看最终改动' })}
              </Button>
              <Button size="sm" className="h-6 px-2" onClick={createAnother} data-goal-end-action="another">
                {t('goal.end.another', { defaultValue: '再做一个' })}
              </Button>
            </>
          ) : null}
          {outcome === 'impossible' ? (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2" onClick={onFork} data-goal-end-action="fork">
                {t('goal.end.changeCondition', { defaultValue: '改条件' })}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onExpandRounds} data-goal-end-action="log">
                {t('goal.end.viewLog', { defaultValue: '看日志' })}
              </Button>
            </>
          ) : null}
          {outcome === 'stuck' ? (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2" onClick={onResume} data-goal-end-action="retry">
                {t('goal.end.retry', { defaultValue: '继续尝试' })}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onExpandRounds} data-goal-end-action="lastRounds">
                {t('goal.end.lastRounds', { defaultValue: '看最后两轮' })}
              </Button>
            </>
          ) : null}
          {outcome === 'budget' ? (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2" onClick={addBudget} data-goal-end-action="budget">
                {t('goal.end.addBudget', { defaultValue: '加预算继续' })}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onExpandRounds} data-goal-end-action="end">
                {t('goal.end.finish', { defaultValue: '结束' })}
              </Button>
            </>
          ) : null}
          {outcome === 'cancelled' ? (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2" onClick={createAnother} data-goal-end-action="recreate">
                {t('goal.end.recreate', { defaultValue: '重新创建' })}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2" data-goal-end-action="keepChatting">
                {t('goal.end.keepChatting', { defaultValue: '把这段当普通对话继续' })}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
