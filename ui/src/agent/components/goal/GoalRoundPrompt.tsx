// A goal round's brief, as a system block (product §5.4, §5.6).
//
// The scheduler posts the round's instructions as an inbound message, so the
// transcript holds them as an ordinary user message — and used to render them in
// the user's own bubble, which made the platform look like it was talking to
// itself in the user's voice. They are folded by default: the brief is long, and
// what the reader usually wants is the round number and the goal it is about.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Target } from 'lucide-react'

import { cn } from '../../lib/utils'
import type { GoalPrompt } from '../../lib/goalMessage'

/** The goal line in the folded state: one line, cut, never wrapped. */
const SUMMARY_CHARS = 40

export function GoalRoundPrompt({ prompt, content }: { prompt: GoalPrompt; content: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const label =
    prompt.kind === 'verify'
      ? t('goal.system.verify', { defaultValue: '系统 · 复验轮' })
      : t('goal.system.round', { defaultValue: '系统 · 目标第 {{n}} 轮', n: prompt.round })
  const summary =
    prompt.goal.length > SUMMARY_CHARS ? `${prompt.goal.slice(0, SUMMARY_CHARS)}…` : prompt.goal
  return (
    <div
      className="flex justify-start"
      data-goal-system=""
      data-goal-system-kind={prompt.kind}
      data-goal-system-round={prompt.round}
    >
      {/* The left bar is the speaker's colour: grey for the platform, which is
          what "this is not a person talking" has to look like. */}
      <div className="w-fit min-w-0 max-w-full overflow-hidden rounded-lg rounded-bl-sm border border-l-2 border-l-muted-foreground/50 bg-muted/30 text-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:bg-accent/60"
        >
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 transition-transform', open ? '' : '-rotate-90')}
          />
          <Target className="h-3 w-3 shrink-0" />
          <span className="whitespace-nowrap text-xs font-medium">{label}</span>
          {summary ? (
            <span className="min-w-0 truncate text-xs opacity-80" title={prompt.goal}>
              · {summary}
            </span>
          ) : null}
        </button>
        {open ? (
          // Plain text, not markdown: the brief's own layout (headings, bullets,
          // 【…】) is the information, and a markdown pass would re-flow it.
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t px-3 py-2 font-sans text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {content}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
