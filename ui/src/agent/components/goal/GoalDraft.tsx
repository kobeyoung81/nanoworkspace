// The confirmation card (product §5.4 / design §13 step 3).
//
// Six rows, read-only until you click one; the risk line is computed by the
// server; a blocker replaces the start button with what to change. The draft is
// a server object, so every edit is written as it is made.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Pencil, Target, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { answerDraft, createDraft, startDraft, type DraftView, type Goal } from '../../lib/goalApi'

type Props = {
  agentId: string
  sessionKey: string
  planRef?: string
  /** The sentence typed in the description state; written as the condition. */
  initialCondition?: string
  onClose: () => void
  onStarted: (goal: Goal) => void
}

/** One row: a label, its value, and an editor that opens in place. */
function Row({
  label,
  value,
  hint,
  editing,
  onEdit,
  onCancel,
  onCommit,
  rows,
}: {
  label: string
  value: string
  hint?: string
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onCommit: (next: string) => void
  rows?: number
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value, editing])
  const shared = {
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    className:
      'w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring',
  }
  return (
    <div className="flex flex-col gap-1 border-b py-2 last:border-b-0" data-goal-row={label}>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
        {editing ? null : (
          <>
            <span className={cn('min-w-0 flex-1 text-sm', !value && 'text-muted-foreground')}>
              {value || '—'}
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onEdit} aria-label="编辑">
              <Pencil className="size-3" />
            </Button>
          </>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-1 pl-24">
          {rows && rows > 1 ? <textarea rows={rows} {...shared} /> : <input {...shared} />}
          {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onCommit(text)}>
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function GoalDraft({ agentId, sessionKey, planRef, initialCondition, onClose, onStarted }: Props) {
  const { t } = useTranslation()
  const [view, setView] = useState<DraftView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    createDraft(agentId, sessionKey, planRef)
      .then(async (v) => {
        if (cancelled) return
        // The description the user typed is the condition: writing it here keeps
        // the card from asking for the one thing they already said.
        if (initialCondition && !v.draft.condition) {
          try {
            v = await answerDraft(v.draft.id, 'condition', initialCondition)
          } catch {
            // keep the card as it is; the row is editable either way
          }
        }
        if (!cancelled) setView(v)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [agentId, sessionKey, planRef, initialCondition])

  const answer = useCallback(
    async (check: string, value: string) => {
      if (!view) return
      setBusy(true)
      setEditing(null)
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
        <span>{error}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
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
  const missing = verdict?.missing ?? []
  const blockers = verdict?.blockers ?? []
  const risks = verdict?.risks ?? []
  const filled = verdict?.filled?.length ?? 0
  const ready = missing.length === 0 && blockers.length === 0
  const proofLine = (draft.proof ?? []).map((p) => p.note || p.cmd || p.path || '').filter(Boolean).join('；')

  return (
    <div className="m-2 overflow-hidden rounded-lg border bg-card shadow-sm" data-goal-draft={draft.id}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Target className="size-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">
          {t('goal.draft.cardTitle', { defaultValue: '◎ 长程目标 · 待确认' })}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t('goal.draft.progress', { defaultValue: '目标补全 {{done}}/6', done: filled })}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('common.close', { defaultValue: '关闭' })}>
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="px-3">
        <Row
          label={t('goal.check.condition', { defaultValue: '完成条件' })}
          value={draft.condition ?? ''}
          hint={t('goal.draft.conditionHint', { defaultValue: '全部满足才算完成；写成可以被证据证明的样子' })}
          editing={editing === 'condition'}
          onEdit={() => setEditing('condition')}
          onCancel={() => setEditing(null)}
          onCommit={(v) => answer('condition', v)}
          rows={3}
        />
        <Row
          label={t('goal.check.proof', { defaultValue: '怎么证明' })}
          value={proofLine}
          hint={t('goal.draft.proofHint', { defaultValue: '每行一条命令或检查，判定员按它核对证据' })}
          editing={editing === 'proof'}
          onEdit={() => setEditing('proof')}
          onCancel={() => setEditing(null)}
          onCommit={(v) => answer('proof', v)}
          rows={3}
        />
        <Row
          label={t('goal.check.approach', { defaultValue: '怎么走' })}
          value={draft.title ?? ''}
          editing={editing === 'approach'}
          onEdit={() => setEditing('approach')}
          onCancel={() => setEditing(null)}
          onCommit={(v) => answer('approach', v)}
        />
        <Row
          label={t('goal.check.constraints', { defaultValue: '不许动' })}
          value={(draft.constraints ?? []).join('；')}
          editing={editing === 'constraints'}
          onEdit={() => setEditing('constraints')}
          onCancel={() => setEditing(null)}
          onCommit={(v) => answer('constraints', v)}
          rows={2}
        />
        <Row
          label={t('goal.check.budget', { defaultValue: '预算' })}
          value={`${draft.max_rounds} 轮 / ${draft.max_minutes} 分钟`}
          editing={editing === 'budget'}
          onEdit={() => setEditing('budget')}
          onCancel={() => setEditing(null)}
          onCommit={(v) => answer('budget', v)}
        />
        <div className="flex items-center gap-2 py-2 text-xs">
          <span className="w-24 shrink-0 text-muted-foreground">
            {t('goal.check.permissions', { defaultValue: '需要你开' })}
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            {t('goal.draft.permissionsOk', { defaultValue: '写文件、执行命令（当前均允许）' })}
          </span>
        </div>
      </div>

      {blockers.length > 0 ? (
        <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-goal-blockers>
          {blockers.map((b) => (
            <div key={b} className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-medium">{t('goal.draft.riskLabel', { defaultValue: '风险' })}</span>
        {risks.map((r) => (
          <span key={r} className="flex items-center gap-1">
            <AlertTriangle className="size-3 shrink-0" />
            {r}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        {missing.length > 0 ? (
          <span className="text-xs text-amber-600" data-goal-missing>
            {t('goal.draft.missing', { defaultValue: '还差：' })}
            {missing.map((m) => t(`goal.check.${m}`, { defaultValue: m })).join('、')}
          </span>
        ) : (
          <span className="text-xs text-emerald-600">{t('goal.draft.ready', { defaultValue: '六项齐全，可以开始' })}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.cancel', { defaultValue: '取消' })}
          </Button>
          {ready ? (
            <Button size="sm" disabled={busy} onClick={start} data-goal-start="on">
              {t('goal.draft.start', { defaultValue: '开始' })}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <div className="px-3 pb-2 text-xs text-destructive">{error}</div> : null}
    </div>
  )
}
