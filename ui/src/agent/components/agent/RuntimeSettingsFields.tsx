import { useTranslation } from 'react-i18next'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { RuntimeSettings } from './runtimeSettings'

type Field = { key: string; kind: 'number' | 'duration' | 'bool' }

// Canonical runtime setting keys (see nanoprotocol AgentTypeDef.Settings).
const FIELDS: Field[] = [
  { key: 'max_tool_result_chars', kind: 'number' },
  { key: 'summarize_token_percent', kind: 'number' },
  { key: 'summarize_message_threshold', kind: 'number' },
  { key: 'title_refresh_messages', kind: 'number' },
  { key: 'memory_recent_days', kind: 'number' },
  { key: 'recent_messages', kind: 'number' },
  { key: 'restrict_to_workspace', kind: 'bool' },
  { key: 'shell_timeout', kind: 'duration' },
]

const EMPTY = '__inherit__'

// RuntimeSettingsFields edits the runtime policy/tool settings map. An empty
// value means "inherit" (the AgentType value, or the runtime code default when
// editing a type). When `applicable` is provided, fields that do not affect the
// current definition shape are shown disabled with a hint (their values are
// preserved on save).
export function RuntimeSettingsFields({
  value,
  onChange,
  applicable,
}: {
  value: RuntimeSettings
  onChange: (next: RuntimeSettings) => void
  applicable?: string[]
}) {
  const { t } = useTranslation()

  const set = (key: string, v: string) => {
    const next = { ...value }
    if (v === '') {
      delete next[key]
    } else {
      next[key] = v
    }
    onChange(next)
  }

  const isApplicable = (key: string) => !applicable || applicable.includes(key)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map(({ key, kind }) => {
        const label = t(`agentSettings.${key}`)
        const current = value[key] ?? ''
        const enabled = isApplicable(key)
        const hint = enabled ? null : (
          <span className="text-[11px] text-muted-foreground">{t('agentSettings.notApplicable')}</span>
        )
        if (kind === 'bool') {
          return (
            <label key={key} className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{label}</span>
              <Select
                value={current || EMPTY}
                onValueChange={(v) => set(key, v === EMPTY ? '' : v)}
                disabled={!enabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY}>{t('agentSettings.inherit')}</SelectItem>
                  <SelectItem value="true">{t('agentSettings.enabled')}</SelectItem>
                  <SelectItem value="false">{t('agentSettings.disabled')}</SelectItem>
                </SelectContent>
              </Select>
              {hint}
            </label>
          )
        }
        return (
          <label key={key} className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{label}</span>
            <Input
              type={kind === 'number' ? 'number' : 'text'}
              value={current}
              disabled={!enabled}
              placeholder={kind === 'duration' ? t('agentSettings.durationPlaceholder') : t('agentSettings.inherit')}
              onChange={(event) => set(key, event.target.value)}
            />
            {hint}
          </label>
        )
      })}
    </div>
  )
}
