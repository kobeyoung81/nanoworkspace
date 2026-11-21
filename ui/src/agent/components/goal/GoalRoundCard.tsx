// One round of a goal, as a card (product §5.8 / design §16).
//
// Collapsed it is one line: which round, how many files, the verdict. Expanded
// it shows what the round said and the judge's answer — both read from the
// round's own goal_report tool result in this conversation, so the evidence is
// the transcript's, not a second copy.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { cn } from '../../lib/utils'
import type { AgentToolEntry } from '../../hooks/useAgent'
import type { Goal } from '../../lib/goalApi'

type RoundSummary = NonNullable<Goal['rounds']>[number]

/** findReport returns the goal_report tool entry for one round, if it is loaded. */
export function findReport(entries: AgentToolEntry[], round: number): AgentToolEntry | undefined {
  for (const entry of entries) {
    if (entry.name !== 'goal_report') continue
    try {
      const args = JSON.parse(entry.args) as { round?: number }
      if (args.round === round) return entry
    } catch {
      // an unparsable call is not this round's report
    }
  }
  return undefined
}

/** reportFor picks the round's tool entry out of the transcript's tool groups. */
export function reportFor(
  messages: ReadonlyArray<{ role: string; kind?: string; tools?: AgentToolEntry[] }>,
  round: number,
): AgentToolEntry | undefined {
  for (const message of messages) {
    if (message.role !== 'assistant' || message.kind !== 'tool_group' || !message.tools) continue
    const found = findReport(message.tools, round)
    if (found) return found
  }
  return undefined
}

const VERDICT_LABEL: Record<string, string> = {
  met: 'met',
  not_yet: 'not_yet',
  impossible: 'impossible',
  interrupted: 'interrupted',
  verify_met: 'verify',
  verify_not_yet: 'verify',
}

export function GoalRoundCard({
  round,
  entry,
}: {
  round: RoundSummary
  entry?: AgentToolEntry
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const interrupted = round.verdict === 'interrupted'
  const verify = round.verdict.startsWith('verify_')
  const label = VERDICT_LABEL[round.verdict] ?? round.verdict

  const parsed = (() => {
    if (!entry) return null
    try {
      const args = JSON.parse(entry.args) as {
        summary?: string
        evidence?: { kind: string; cmd?: string; exit?: number; path?: string; note?: string; items?: { text: string; done: boolean }[] }[]
      }
      return args
    } catch {
      return null
    }
  })()

  return (
    <li
      className={cn('rounded border px-2 py-1', interrupted && 'opacity-60')}
      data-goal-round={round.n}
      data-goal-round-kind={interrupted ? 'interrupted' : verify ? 'verify' : 'normal'}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className="shrink-0 text-muted-foreground">第 {round.n + 1} 轮</span>
        {verify ? (
          <span className="shrink-0 rounded-full border border-primary/40 px-1.5 text-[10px] text-primary">
            {t('goal.round.verify', { defaultValue: '复验' })}
          </span>
        ) : null}
        {interrupted ? (
          <span className="shrink-0 text-[10px]">{t('goal.round.interrupted', { defaultValue: '被中断' })}</span>
        ) : (
          <>
            <span className="shrink-0 text-muted-foreground">
              {t('goal.round.files', { defaultValue: '改了 {{n}} 个文件', n: round.files })}
            </span>
            <span
              className={cn(
                'shrink-0',
                round.verdict === 'met' ? 'text-emerald-600' : round.verdict === 'impossible' ? 'text-destructive' : 'text-amber-600',
              )}
            >
              {label}
            </span>
          </>
        )}
      </button>
      {open ? (
        <div className="mt-1 space-y-1 border-t pt-1 text-[11px]">
          {parsed?.summary ? <p className="text-muted-foreground">{parsed.summary}</p> : null}
          {parsed?.evidence?.length ? (
            <ul className="space-y-0.5 font-mono">
              {parsed.evidence.map((e, i) => (
                <li key={i} className="truncate" title={e.cmd ?? e.path ?? e.note}>
                  {e.kind === 'command'
                    ? `$ ${e.cmd} → ${e.exit ?? '?'}`
                    : e.kind === 'file'
                      ? e.path
                      : (e.items ?? []).map((it) => `${it.done ? '✓' : '·'} ${it.text}`).join('  ')}
                </li>
              ))}
            </ul>
          ) : null}
          {entry?.result ? (
            <p className="text-muted-foreground" data-goal-round-judge>
              {entry.result.length > 400 ? `${entry.result.slice(0, 400)}…` : entry.result}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {t('goal.round.noEvidence', { defaultValue: '这一轮的证据在更早的片段里' })}
            </p>
          )}
        </div>
      ) : null}
    </li>
  )
}
