// The three attention dots, shared by agent rows and group headers.
//
// Blue: a pending question. Yellow: a turn is running. Green: a turn finished
// and the conversation has not been read since. Yellow and green are mutually
// exclusive — while a turn runs there is nothing "finished but unread" yet.
//
// All three are the same size and have no animation: the old running dot pulsed,
// which made it look larger than the others.

import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('size-1.5 shrink-0 rounded-full', className)}
    />
  )
}

export function AttentionDots({
  running,
  awaiting,
  unread,
  className,
}: {
  running: boolean
  awaiting: boolean
  unread: boolean
  className?: string
}) {
  const { t } = useTranslation()
  if (!running && !awaiting && !unread) {
    return null
  }
  return (
    <span data-agent-attention="" className={cn('flex shrink-0 items-center gap-1', className)}>
      {awaiting ? <Dot className="bg-info" label={t('agent.tabs.awaiting')} /> : null}
      {running ? <Dot className="bg-warning" label={t('agent.tabs.busy')} /> : null}
      {!running && unread ? <Dot className="bg-success" label={t('agent.tabs.unread')} /> : null}
    </span>
  )
}
