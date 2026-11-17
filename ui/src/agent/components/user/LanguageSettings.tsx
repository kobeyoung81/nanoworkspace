// The reply language, as this account has it.
//
// The platform ships a default; an account may override it here. There is no
// "follow the message" option: the language is a setting, so what the console
// shows is exactly what the agent is told in its per-turn language note.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../lib/toast'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { getSession } from '../../lib/auth'
import {
  LANGUAGES,
  getPreferences,
  languageLabel,
  savePreferences,
  type LanguagePreference,
} from '../../lib/preferences'

// Radix reserves the empty string for "no value", so inheriting needs a sentinel.
const INHERIT = 'inherit'

export function LanguageSettings() {
  const { t } = useTranslation()
  const userID = getSession()?.user_id
  const [pref, setPref] = useState<LanguagePreference | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!userID) return
    let cancelled = false
    getPreferences(userID)
      .then((value) => {
        if (!cancelled) setPref(value)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [userID])

  const choose = async (value: string) => {
    if (!userID || saving) return
    setSaving(true)
    try {
      const next = await savePreferences(userID, value === INHERIT ? '' : value)
      setPref(next)
      toast.success(t('userConfig.language.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const platformDefault = pref && pref.source === 'platform' ? pref.language : ''
  const effective = pref?.language ? languageLabel(pref.language) : t('userConfig.language.none')

  return (
    <section className="space-y-2" data-language-settings="">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('userConfig.language.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('userConfig.language.hint')}</p>
      </div>
      {failed ? (
        // Reading failed: the platform default is unknown, so changing the value
        // here could write a guess over a real setting. Refuse until it loads.
        <p className="text-xs text-destructive">{t('userConfig.language.loadFailed')}</p>
      ) : null}
      <Select
        value={pref?.source === 'user' ? pref.language : INHERIT}
        onValueChange={(value) => void choose(value)}
        disabled={!pref || failed || saving}
      >
        <SelectTrigger className="w-full sm:w-72" aria-label={t('userConfig.language.title')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>
            {t('userConfig.language.inherit', {
              language: platformDefault ? languageLabel(platformDefault) : t('userConfig.language.none'),
            })}
          </SelectItem>
          {LANGUAGES.map((language) => (
            <SelectItem key={language.tag} value={language.tag}>
              {language.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pref ? (
        <p className="text-xs text-muted-foreground" data-language-effective={pref.language}>
          {t('userConfig.language.effective', {
            language: effective,
            source: t(
              pref.source === 'user' ? 'userConfig.language.sourceUser' : 'userConfig.language.sourcePlatform',
            ),
          })}
        </p>
      ) : null}
    </section>
  )
}
