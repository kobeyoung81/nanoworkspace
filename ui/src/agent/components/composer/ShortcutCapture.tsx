// The button that records a key combination.
//
// Clicking it puts the page into a one-key capture: the next press becomes the
// shortcut, Esc leaves it alone, and presses that are only modifiers keep
// waiting. The listener runs in the capture phase and stops the event, so the
// key that configures dictation never also triggers it.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { isMacPlatform, shortcutFromEvent, shortcutLabel } from '../../lib/shortcut'

export function ShortcutCapture({
  value,
  onChange,
  disabled,
}: {
  /** The shortcut to show; empty renders the placeholder instead. */
  value: string
  onChange: (spec: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) {
      return
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      // The capture owns the keyboard until it has an answer: the shortcut being
      // recorded must not also reach the composer's own listener or the page.
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      const spec = shortcutFromEvent(event)
      if (!spec) {
        return
      }
      setRecording(false)
      onChange(spec)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  const label = shortcutLabel(value, isMacPlatform())

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      data-shortcut-capture=""
      aria-label={t('composer.shortcut.label')}
      onClick={() => setRecording((on) => !on)}
      className={cn(
        'h-8 min-w-[7rem] justify-center px-2 font-mono text-xs',
        recording && 'border-primary text-primary',
      )}
    >
      {recording ? t('composer.shortcut.recording') : label || t('composer.shortcut.unset')}
    </Button>
  )
}
