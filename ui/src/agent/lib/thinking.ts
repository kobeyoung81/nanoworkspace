// The thinking level's three layers, resolved the way the runtime resolves
// them.
//
// The runtime is authoritative (nanosec/cmd/nanosec/models.go's
// resolveThinkingEffort); this is the display copy, so the composer and the user
// config page can show what is actually in effect and where it comes from. The
// portal's resolveTaskMode follows the same pattern, for the same reason.
//
// Most specific first:
//   1. the user's explicit choice (agent_type_overrides.thinking)
//   2. the model's capability — a model the catalog switched off cannot think
//   3. the platform default (agent_types.settings.thinking)
//   4. the model entry's own effort

import type { TypeModelBinding } from './agentTypes'

export const THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** The AgentType setting holding the platform default for a type (per mode). */
export const THINKING_SETTING_KEY = 'thinking'

/** Where the level in effect comes from. */
export type ThinkingSource = 'user' | 'platform' | 'model'

/** The parts of a catalog model the resolution needs. */
export type ThinkingModel = {
  thinking_enabled?: boolean
  thinking_effort?: string
}

/**
 * normalizeThinkingLevel maps a stored value onto a level. `none` is the
 * spelling the runtime normalizes `off` to, and an empty or unrecognized value
 * means "no choice" — the caller falls back to the next layer rather than
 * showing a value nothing would use.
 */
export function normalizeThinkingLevel(raw: string | null | undefined): ThinkingLevel | '' {
  if (raw === 'off' || raw === 'none') return 'off'
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return ''
}

/** What a model's own catalog entry asks for. */
export function modelThinkingLevel(model?: ThinkingModel | null): ThinkingLevel {
  if (model && model.thinking_enabled === false) return 'off'
  return normalizeThinkingLevel(model?.thinking_effort) || 'medium'
}

/**
 * effectiveModelID is the model a (agent, mode) actually runs: a locked type
 * default wins, then the stored override when the mode still allows it, then the
 * type default, then the first binding. Mirrors nanosec's defEffectiveModel.
 */
export function effectiveModelID(
  bindings: TypeModelBinding[] | undefined,
  overrideModelID?: number,
): number | undefined {
  const allowed = bindings ?? []
  if (allowed.length === 0) return overrideModelID
  const locked = allowed.find((b) => b.is_default && b.locked)
  if (locked) return locked.model_id
  if (overrideModelID !== undefined && allowed.some((b) => b.model_id === overrideModelID)) {
    return overrideModelID
  }
  const fallback = allowed.find((b) => b.is_default) ?? allowed[0]
  return fallback.model_id
}

export type ResolvedThinking = { level: ThinkingLevel; source: ThinkingSource }

/** resolveThinking applies the four layers and says which one won. */
export function resolveThinking(input: {
  override?: string | null
  typeDefault?: string | null
  model?: ThinkingModel | null
}): ResolvedThinking {
  const user = normalizeThinkingLevel(input.override)
  if (user) return { level: user, source: 'user' }
  if (input.model && input.model.thinking_enabled === false) return { level: 'off', source: 'model' }
  const platform = normalizeThinkingLevel(input.typeDefault)
  if (platform) return { level: platform, source: 'platform' }
  return { level: modelThinkingLevel(input.model), source: 'model' }
}
