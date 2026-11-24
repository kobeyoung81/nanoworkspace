// The plan-completion card (product §5.3, design §14).
//
// It is not a parse of "计划已写好": the card is rendered where the conversation
// has an unused plan, and the check is the two keys the session meta already
// carries — last_plan_path exists, and plan_executed is not it. It follows the
// message it belongs to, so once scrolled away it is gone; the instruction menu
// finds the same plan again through the same keys.
//
// Once the plan is used the card stays where it is, greyed out: the reader can
// still open the plan, but there is nothing left to create from it.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText, Target } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { parsePlanCard } from '../../lib/planCard'

export function PlanCard({
  planPath,
  used,
  text,
  onCreate,
}: {
  agentId: string
  planPath: string
  /** The plan has been consumed: show it, offer nothing. */
  used?: boolean
  /** The plan markdown, read once by the pane: the status control needs its step count too. */
  text?: string | null
  onCreate: (planPath: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const plan = useMemo(() => (text ? parsePlanCard(text) : null), [text])
  if (used) return null
  const steps = plan?.steps ?? []
  const shown = steps.slice(0, 3)

  return (
    <div
      className={cn(
        'mt-1 w-full max-w-xl rounded-lg border bg-card px-3 py-2 text-xs shadow-sm',
        used && 'opacity-60',
      )}
      data-goal-plan-card
      data-goal-plan-used={used ? '' : undefined}
    >
      <div className="flex items-center gap-2">
        <FileText className={cn('size-3.5 shrink-0', used ? 'text-muted-foreground' : 'text-primary')} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {t('goal.plan.card', { defaultValue: '计划已写好 · {{n}} 步', n: steps.length })}
        </span>
        {used ? (
          <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t('goal.plan.used', { defaultValue: '已使用' })}
          </span>
        ) : null}
        {plan?.title ? <span className="min-w-0 truncate text-muted-foreground">{plan.title}</span> : null}
      </div>
      {!used && shown.length > 0 ? (
        <ol className="mt-1.5 space-y-0.5 text-muted-foreground">
          {shown.map((step, index) => (
            <li key={index} className="truncate">
              {index + 1} · {step}
            </li>
          ))}
          {steps.length > shown.length ? (
            <li className="opacity-70">
              {t('goal.plan.more', { defaultValue: '还有 {{n}} 步……', n: steps.length - shown.length })}
            </li>
          ) : null}
        </ol>
      ) : null}
      {open && text ? (
        <div
          className="mt-1.5 max-h-64 overflow-auto rounded border bg-muted/20 px-3 py-2 text-[11px] leading-relaxed"
          data-goal-plan-md
        >
          <pre className="whitespace-pre-wrap">{text}</pre>
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {text ? (
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setOpen((v) => !v)} data-goal-plan-toggle>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {open
              ? t('goal.plan.collapse', { defaultValue: '收起计划' })
              : t('goal.plan.expand', { defaultValue: '展开计划' })}
          </Button>
        ) : null}
        {!used ? (
          <Button size="sm" className="h-6 px-2" onClick={() => onCreate(planPath)} data-goal-plan-create>
            <Target className="size-3.5" />
            {t('goal.plan.create', { defaultValue: '生成长程目标' })}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
