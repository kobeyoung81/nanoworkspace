import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '../lib/utils'
import { Button } from '../ui/button'

// Reload = fetch the file again and rebuild the preview, not just repaint it:
// that is what recovers a renderer that stalled, a file that changed on disk,
// and a preview that ended in the error state.
//
// `animate-spin` is already covered by the Chrome 103 fallback block in
// `index.css` (transform-origin), so no bespoke animation here.
export function PreviewReloadButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={loading}
      aria-label={t('files.reload')}
      title={t('files.reload')}
    >
      <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
      <span className="hidden sm:inline">{t('files.reload')}</span>
    </Button>
  )
}
