// The judge's verdict on one round, as a card of its own (product §5.4).
//
// It used to be a sentence inside the folded tool group, next to the raw call and
// result — which made the one conclusion of the round look like the agent
// grading its own work. The verdict is the most important line of a round, so it
// sits outside the group, in the judge's colour.

import { useTranslation } from 'react-i18next'
import { Scale } from 'lucide-react'

import { cn } from '../../lib/utils'
import type { GoalJudgeResult } from '../../lib/goalMessage'

const VERDICT_TONE: Record<string, { bar: string; text: string }> = {
  met: { bar: 'border-l-emerald-500', text: 'text-emerald-600' },
  not_yet: { bar: 'border-l-amber-500', text: 'text-amber-600' },
  impossible: { bar: 'border-l-destructive', text: 'text-destructive' },
}

export function GoalJudgeCard({ result }: { result: GoalJudgeResult }) {
  const { t } = useTranslation()
  const tone = VERDICT_TONE[result.verdict] ?? { bar: 'border-l-border', text: 'text-muted-foreground' }
  const label = result.verify
    ? t('goal.judge.roundVerify', { defaultValue: '判定员 · 第 {{n}} 轮（复验）', n: result.round })
    : t('goal.judge.round', { defaultValue: '判定员 · 第 {{n}} 轮', n: result.round })
  return (
    <div className="flex justify-start" data-goal-judge="" data-goal-judge-verdict={result.verdict}>
      <div
        className={cn(
          'w-fit min-w-0 max-w-full break-words rounded-lg rounded-bl-sm border border-l-2 bg-card px-2.5 py-1.5 text-xs [overflow-wrap:anywhere]',
          tone.bar,
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Scale className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="whitespace-nowrap font-medium text-muted-foreground">{label}</span>
          <span className={cn('shrink-0 font-semibold', tone.text)}>{result.verdict}</span>
        </div>
        {result.reason ? (
          <p className="mt-1 max-w-prose whitespace-pre-wrap leading-relaxed text-muted-foreground">
            {result.reason}
          </p>
        ) : null}
      </div>
    </div>
  )
}
