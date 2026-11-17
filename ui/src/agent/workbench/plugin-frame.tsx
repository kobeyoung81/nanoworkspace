import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/utils'
import { Spinner } from '../components/ui/spinner'
import { Button } from '../components/ui/button'

type PluginFrameProps = {
  busy?: boolean
  error?: string | null
  onRetry?: () => void
  children: ReactNode
  className?: string
}

// PluginFrame is the shared plugin body scaffold: standard busy/error states.
// All chrome (name tag, header actions, docks) is owned by the workbench; a
// plugin renders only its content here.
export function PluginFrame({ busy, error, onRetry, children, className }: PluginFrameProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {busy ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <p className="text-sm text-destructive">{error}</p>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}