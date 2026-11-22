// The plan-completion card (product §5.3, design §14).
//
// It is not a parse of "计划已写好": the card is rendered where the conversation
// has an unused plan, and the check is the two keys the session meta already
// carries — last_plan_path exists, and plan_executed is not it. It follows the
// message it belongs to, so once scrolled away it is gone; the instruction menu
// finds the same plan again through the same keys.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText, Target } from 'lucide-react'

import { Button } from '../ui/button'
import { readTextFile } from '../../lib/api'
import { parsePlanCard, type PlanCard as ParsedPlan } from '../../lib/planCard'

export function PlanCard({
  agentId,
  planPath,
  onCreate,
}: {
  agentId: string
  planPath: string
  onCreate: (planPath: string) => void
}) {
  const { t } = useTranslation()
  const [plan, setPlan] = useState<ParsedPlan | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readTextFile(agentId, planPath)
      .then((md) => {
        if (cancelled || md == null) return
        setPlan(parsePlanCard(md))
        setText(md)
      })
      .catch(() => {
        // A plan that cannot be read still offers the button: the workspace
        // reads the file again when the draft is created.
      })
    return () => {
      cancelled = true
    }
  }, [agentId, planPath])

  const steps = plan?.steps ?? []
  const shown = steps.slice(0, 3)

  return (
    <div
      className="mt-1 w-full max-w-xl rounded-lg border bg-card px-3 py-2 text-xs shadow-sm"
      data-goal-plan-card
    >
      <div className="flex items-center gap-2">
        <FileText className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {t('goal.plan.card', {
            defaultValue: '计划已写好 · {{n}} 步',
            n: steps.length,
          })}
        </span>
        {plan?.title ? <span className="min-w-0 truncate text-muted-foreground">{plan.title}</span> : null}
      </div>
      {shown.length > 0 ? (
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
        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-muted/20 p-2 font-mono text-[11px]">
          {text}
        </pre>
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
        <Button size="sm" className="h-6 px-2" onClick={() => onCreate(planPath)} data-goal-plan-create>
          <Target className="size-3.5" />
          {t('goal.plan.create', { defaultValue: '生成长程目标' })}
        </Button>
      </div>
    </div>
  )
}
