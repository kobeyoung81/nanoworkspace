// The thinking-level selector: the four levels plus "follow the default".
//
// It is shared by the two form surfaces that own the level — the per-(agent,
// mode) override on the user config page, and the platform default on the agent
// type page — so both offer the same vocabulary and the same "what does the
// default mean right now" hint. The composer's compact menu renders the same
// set inline (see AgentPage's ThinkingLevelMenu).

import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { THINKING_LEVELS, type ResolvedThinking, type ThinkingLevel } from '../../lib/thinking'
import type { ThinkingChoice } from '../../hooks/useThinkingLevel'

// Radix Select cannot carry an empty value, so "follow the default" is its own
// item.
const INHERIT = '__inherit__'

const SOURCE_KEY: Record<ResolvedThinking['source'], string> = {
  user: 'thinking.sourceUser',
  platform: 'thinking.sourcePlatform',
  model: 'thinking.sourceModel',
}

export function ThinkingLevelField({
  choice,
  resolved,
  onChange,
  disabled,
  inheritLabel,
  hint,
}: {
  /** The stored choice; '' means "follow the default". */
  choice: ThinkingChoice
  /** The level in effect and its source, for the hint. Omit on a surface whose
   * value is a platform default rather than something that resolves. */
  resolved?: ResolvedThinking
  onChange: (next: ThinkingChoice) => void
  disabled?: boolean
  /** Wording of the empty option; defaults to "follow the default (level)". */
  inheritLabel?: string
  /** Replaces the effective-value hint. */
  hint?: string
}) {
  const { t } = useTranslation()
  const levelLabel = (level: ThinkingLevel) => t(`thinking.${level}`)
  const followLabel =
    inheritLabel ?? t('thinking.followDefault', { value: levelLabel(resolved?.level ?? 'medium') })
  const hintText =
    hint ??
    (resolved ? t('thinking.source', { value: levelLabel(resolved.level), source: t(SOURCE_KEY[resolved.source]) }) : '')

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{t('thinking.label')}</label>
      <Select
        value={choice || INHERIT}
        onValueChange={(v) => onChange(v === INHERIT ? '' : (v as ThinkingLevel))}
        disabled={disabled}
      >
        <SelectTrigger className="w-full sm:w-96">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>{followLabel}</SelectItem>
          {THINKING_LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {levelLabel(level)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hintText ? <p className="text-xs text-muted-foreground">{hintText}</p> : null}
    </div>
  )
}
