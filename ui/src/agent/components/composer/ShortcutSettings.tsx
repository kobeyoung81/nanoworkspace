// The dictation shortcut, as this browser has it.
//
// The platform sets a default (the voice console's shortcut field); this is
// where a user replaces it with a key their own keyboard, layout and extensions
// leave alone — or turns it off. The value is a device property, so it lives in
// the user-level preferences tab rather than beside the platform's voice
// configuration, and it is stored per account in client state.

import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { ShortcutCapture } from './ShortcutCapture'
import { useVoiceConfig } from '../../voice/useVoiceConfig'
import { isMacPlatform, resolveShortcut, shortcutLabel } from '../../lib/shortcut'
import {
  clearShortcutOverride,
  getShortcutOverride,
  subscribeShortcutOverride,
  writeShortcutOverride,
} from '../../lib/voiceShortcut'

export function ShortcutSettings() {
  const { t } = useTranslation()
  const config = useVoiceConfig()
  // The composer reads the same store, so a change here reaches a mounted
  // dictation listener without it having to remount.
  const override = useSyncExternalStore(subscribeShortcutOverride, getShortcutOverride, getShortcutOverride)
  const platform = config?.shortcut ?? ''
  const effective = resolveShortcut(override, platform)

  const source =
    override === null
      ? t('composer.shortcut.sourcePlatform')
      : override === ''
        ? t('composer.shortcut.sourceOff')
        : t('composer.shortcut.sourceOwn')

  return (
    <section className="space-y-3" data-shortcut-settings="">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('composer.shortcut.label')}</h3>
        <p className="text-xs text-muted-foreground">{t('composer.shortcut.hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ShortcutCapture value={effective} onChange={writeShortcutOverride} />
        {override !== null ? (
          <Button type="button" variant="outline" size="sm" onClick={clearShortcutOverride}>
            {t('composer.shortcut.followPlatform')}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => writeShortcutOverride('')}>
          {t('composer.shortcut.turnOff')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" data-shortcut-effective={effective}>
        {effective
          ? t('composer.shortcut.effective', { key: shortcutLabel(effective, isMacPlatform()) })
          : t('composer.shortcut.effectiveNone')}
        {' · '}
        {source}
      </p>
    </section>
  )
}
