// The goal creation card (design §13).
//
// It is a server-backed form: the draft lives in the workspace, every field is
// written as the user leaves it, and the six-check verdict the server returns
// decides whether "开始" is available. Nothing here computes "is this complete" —
// a second implementation would disagree with the one the scheduler trusts.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, ListChecks, Target, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  answerDraft,
  createDraft,
  startDraft,
  type DraftView,
  type Goal,
} from '../../lib/goalApi'

type Props = {
  agentId: string
  sessionKey: string
  planRef?: string
  onClose: () => void
  onStarted: (goal: Goal) => void
}

/** One labelled field with its own write-on-blur behaviour. */
function Field({
  label,
  hint,
  value,
  rows,
  onCommit,
  disabled,
}: {
  label: string
  hint?: string
  value: string
  rows?: number
  onCommit: (next: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    if (text !== value) {
      onCommit(text)
    }
  }
  const shared = {
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
    disabled,
    className:
      'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60',
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {rows && rows > 1 ? <textarea rows={rows} {...shared} /> : <input {...shared} />}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function GoalDraft({ agentId, sessionKey, planRef, onClose, onStarted }: Props) {
  const { t } = useTranslation()
  const [view, setView] = useState<DraftView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    createDraft(agentId, sessionKey, planRef)
      .then((v) => {
        if (!cancelled) setView(v)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [agentId, sessionKey, planRef])

  const answer = useCallback(
    async (check: string, value: string) => {
      if (!view) return
      setBusy(true)
      try {
        setView(await answerDraft(view.draft.id, check, value))
        setError(null)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [view],
  )

  const start = async () => {
    if (!view) return
    setBusy(true)
    try {
      onStarted(await startDraft(view.draft.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !view) {
    return (
      <div className="m-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-goal-draft="error">
        <div className="flex items-center justify-between">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    )
  }
  if (!view) {
    return (
      <div className="m-2 rounded-lg border bg-card p-3 text-sm text-muted-foreground" data-goal-draft="loading">
        {t('goal.draft.loading', { defaultValue: '正在打开目标草稿…' })}
      </div>
    )
  }

  const { draft, verdict } = view
  const ready = verdict.missing.length === 0 && verdict.blockers.length === 0
  const filled = verdict.filled.length

  return (
    <div className="m-2 overflow-hidden rounded-lg border bg-card shadow-sm" data-goal-draft={draft.id}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Target className="size-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">{t('goal.draft.title', { defaultValue: '设定长程目标' })}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          <ListChecks className="size-3.5" />
          {t('goal.draft.progress', { defaultValue: '目标补全 {{done}}/6', done: filled })}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('common.close', { defaultValue: '关闭' })}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="grid max-h-[52vh] gap-2.5 overflow-y-auto p-3 sm:grid-cols-2">
        <Field
          label={t('goal.draft.condition', { defaultValue: '完成条件' })}
          hint={t('goal.draft.conditionHint', { defaultValue: '全部满足才算完成；写成可以被证据证明的样子' })}
          value={draft.condition ?? ''}
          rows={3}
          onCommit={(v) => answer('condition', v)}
          disabled={busy}
        />
        <Field
          label={t('goal.draft.proof', { defaultValue: '怎么证明' })}
          hint={t('goal.draft.proofHint', { defaultValue: '每行一条命令或检查，判定员按它核对证据' })}
          value={(draft.proof ?? []).map((p) => p.note || p.cmd || p.path || '').join('\n')}
          rows={3}
          onCommit={(v) => answer('proof', v)}
          disabled={busy}
        />
        <Field
          label={t('goal.draft.approach', { defaultValue: '怎么走' })}
          hint={t('goal.draft.approachHint', { defaultValue: '一句话说明推进顺序（会作为目标标题）' })}
          value={draft.title ?? ''}
          onCommit={(v) => answer('approach', v)}
          disabled={busy}
        />
        <Field
          label={t('goal.draft.constraints', { defaultValue: '不许动' })}
          hint={t('goal.draft.constraintsHint', { defaultValue: '每行一条约束，例如：不改已有测试' })}
          value={(draft.constraints ?? []).join('\n')}
          rows={2}
          onCommit={(v) => answer('constraints', v)}
          disabled={busy}
        />
        <Field
          label={t('goal.draft.budget', { defaultValue: '预算' })}
          hint={t('goal.draft.budgetHint', { defaultValue: '例如 40 轮 / 180 分钟' })}
          value={`${draft.max_rounds} 轮 / ${draft.max_minutes} 分钟`}
          onCommit={(v) => answer('budget', v)}
          disabled={busy}
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">{t('goal.draft.permissions', { defaultValue: '需要你开的权限' })}</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            {t('goal.draft.permissionsOk', { defaultValue: '没有需要额外开放的权限' })}
          </span>
        </div>
      </div>

      {verdict.blockers.length > 0 ? (
        <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {verdict.blockers.map((b) => (
            <div key={b} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        {verdict.risks.map((r) => (
          <span key={r} className="flex items-center gap-1">
            <AlertTriangle className="size-3 shrink-0" />
            {r}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        {verdict.missing.length > 0 ? (
          <span className="text-xs text-amber-600" data-goal-missing>
            {t('goal.draft.missing', { defaultValue: '还差：' })}
            {verdict.missing.map((m) => t(`goal.check.${m}`, { defaultValue: m })).join('、')}
          </span>
        ) : (
          <span className="text-xs text-emerald-600">{t('goal.draft.ready', { defaultValue: '六项齐全，可以开始' })}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.cancel', { defaultValue: '取消' })}
          </Button>
          <Button size="sm" disabled={!ready || busy} onClick={start} data-goal-start={ready ? 'on' : 'off'}>
            {t('goal.draft.start', { defaultValue: '开始' })}
          </Button>
        </div>
      </div>
      {error ? <div className={cn('px-3 pb-2 text-xs text-destructive')}>{error}</div> : null}
    </div>
  )
}
