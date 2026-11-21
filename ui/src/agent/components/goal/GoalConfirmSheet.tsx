// The confirmation the two destructive controls need (product §5.9).
//
// Pausing finishes the current round; stopping cannot be undone. On a phone the
// sheet slides up from the bottom — the thumb is there, and the action is
// destructive — on a desktop it is a centred dialog.

import { useTranslation } from 'react-i18next'

import { Button } from '../ui/button'

export type ConfirmKind = 'pause' | 'cancel'

export function GoalConfirmSheet({
  kind,
  onConfirm,
  onClose,
}: {
  kind: ConfirmKind
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const text =
    kind === 'pause'
      ? t('goal.pause.confirm', {
          defaultValue: '暂停后当前这一轮会做完，之后不再开始新一轮。随时可以继续。',
        })
      : t('goal.stop.confirm', {
          defaultValue: '叫停后不能恢复，已经完成的工作会保留。要继续请重新创建目标。',
        })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      data-goal-confirm={kind}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-xl border bg-card p-4 shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm">{text}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-goal-confirm-cancel>
            {t('common.cancel', { defaultValue: '取消' })}
          </Button>
          <Button
            size="sm"
            variant={kind === 'cancel' ? 'destructive' : 'default'}
            onClick={onConfirm}
            data-goal-confirm-ok
          >
            {kind === 'pause'
              ? t('goal.banner.pause', { defaultValue: '暂停' })
              : t('goal.banner.cancel', { defaultValue: '叫停' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
