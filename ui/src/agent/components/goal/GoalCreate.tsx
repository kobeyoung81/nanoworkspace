// The split card the instruction menu opens (product §5.1).
//
// It only picks a path: use the plan this conversation already has, or describe a
// new goal. The description itself is not a card — it is the composer in its
// creating state (product §5.2), so the screen has one input box, not two.

import { useTranslation } from 'react-i18next'
import { FileText, X } from 'lucide-react'

import { Button } from '../ui/button'

/** The split card: an unused plan exists, so offer it before asking anything. */
export function GoalSplitCard({
  steps,
  onUsePlan,
  onRestart,
  onClose,
}: {
  steps?: number
  onUsePlan: () => void
  onRestart: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="m-2 rounded-lg border bg-card p-3 shadow-sm" data-goal-split>
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {t('goal.split.title', { defaultValue: '基于当前计划创建？' })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {steps
              ? t('goal.split.hintSteps', {
                  defaultValue: '这个对话里有一份 {{n}} 步的计划，还没有对应的目标。',
                  n: steps,
                })
              : t('goal.split.hint', { defaultValue: '这个对话里有一份还没被用掉的计划。' })}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('common.close', { defaultValue: '关闭' })}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onRestart} data-goal-split="restart">
          {t('goal.split.restart', { defaultValue: '重新描述' })}
        </Button>
        <Button size="sm" onClick={onUsePlan} data-goal-split="use-plan">
          {t('goal.split.usePlan', { defaultValue: '是，用计划' })}
        </Button>
      </div>
    </div>
  )
}
