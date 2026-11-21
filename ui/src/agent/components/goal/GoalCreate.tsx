// The two cards the instruction menu can open (product §5.1 / §5.3).
//
// One asks "create from the plan you already have?"; the other is the empty
// description state. They are separate components because they answer different
// questions: the first only picks a path, the second collects the one sentence a
// goal starts from.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Target, X } from 'lucide-react'

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

/** The description state: one sentence, Enter to continue, Esc to leave. */
export function GoalCreateBar({
  onSubmit,
  onClose,
}: {
  onSubmit: (description: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const submit = () => {
    if (text.trim() === '') return
    onSubmit(text.trim())
  }
  return (
    <div className="m-2 overflow-hidden rounded-lg border border-primary/40 bg-card shadow-sm" data-goal-create>
      <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-1.5">
        <Target className="size-4 shrink-0 text-primary" />
        <span className="text-xs font-medium">
          {t('goal.draft.banner', { defaultValue: '◎ 长程目标 · 待描述' })}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 px-1.5" onClick={onClose}>
          <X className="size-3.5" />
          {t('common.cancel', { defaultValue: '取消' })}
        </Button>
      </div>
      <div className="p-3">
        <textarea
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') {
              onClose()
            }
          }}
          placeholder={t('goal.draft.placeholder', {
            defaultValue: '描述你要达成什么。能写清怎么算做完和怎么看出来最好。',
          })}
          className="w-full resize-none rounded-md border border-primary/30 bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          data-goal-description
        />
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{t('goal.draft.enterHint', { defaultValue: '回车进入确认；Esc 退出，已输入的文字保留' })}</span>
          <Button size="sm" disabled={text.trim() === ''} onClick={submit} data-goal-description-submit>
            {t('goal.draft.continue', { defaultValue: '继续' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
