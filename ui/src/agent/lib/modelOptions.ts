// The composer's model list: one "follow default" entry (the only way to clear
// an override from the composer) followed by the models the current mode
// allows.
//
// Two things used to make this list read wrong. The follow-default entry was
// labelled with the default binding's model name, so an agent whose type
// defaults to "Basic" showed "Basic" twice — once as the entry that means "no
// override", once as the model itself. And the trigger showed that same name
// when the mode had no override, which read as "your choice was reset".
// Labelling the entry as "follow default (Basic)" fixes both: it cannot be
// confused with the model, and it says what following the default resolves to.
import type { TypeModelBinding } from './agentTypes'

/** Sentinel value of the "follow the type default" entry. */
export const FOLLOW_DEFAULT_VALUE = '__default__'

export type ModelSelectOption = {
  value: string
  /** Model name, without any wording around it. */
  modelName: string
  /** What the row renders. */
  label: string
  disabled: boolean
  /** True for the entry that clears the override. */
  followDefault: boolean
}

/** The wording the caller supplies (i18n); the composition stays testable. */
export type ModelOptionLabels = {
  /** Wraps the default's model name, e.g. "follow default (Basic)". */
  followDefault: (modelName: string) => string
  /** Used when the type names no default model. */
  fallback: string
}

/** The default binding of a mode, if the type names one. */
export function defaultBindingOf(allowed: TypeModelBinding[]): TypeModelBinding | undefined {
  return allowed.find((binding) => binding.is_default)
}

/** The model name a binding resolves to, falling back to its id. */
export function bindingName(binding: TypeModelBinding, names: Record<number, string>): string {
  return names[binding.model_id] ?? `#${binding.model_id}`
}

// modelSelectOptions returns the entries in display order. Models repeat if the
// API ever lists one twice; the first occurrence wins so the list never shows
// the same model as two distinct choices.
//
// currentModelID is the stored override. When the mode no longer allows it the
// entry is still added (disabled), so the trigger has a label to render instead
// of falling through to a bare value.
export function modelSelectOptions(
  allowed: TypeModelBinding[],
  names: Record<number, string>,
  currentModelID?: number,
  labels: ModelOptionLabels = { followDefault: (name) => `Follow default (${name})`, fallback: 'Default model' },
): ModelSelectOption[] {
  const seen = new Set<number>()
  const options: ModelSelectOption[] = []
  for (const binding of allowed) {
    if (seen.has(binding.model_id)) {
      continue
    }
    seen.add(binding.model_id)
    const name = bindingName(binding, names)
    options.push({
      value: String(binding.model_id),
      modelName: name,
      label: name,
      disabled: binding.locked,
      followDefault: false,
    })
  }
  if (currentModelID !== undefined && !seen.has(currentModelID)) {
    const name = names[currentModelID] ?? `#${currentModelID}`
    options.push({
      value: String(currentModelID),
      modelName: name,
      label: name,
      disabled: true,
      followDefault: false,
    })
  }
  const fallback = defaultBindingOf(allowed)
  const fallbackName = fallback ? bindingName(fallback, names) : ''
  options.unshift({
    value: FOLLOW_DEFAULT_VALUE,
    modelName: fallbackName,
    // "follow default" must never render as a bare model name: that is what
    // made the entry look like a second copy of the default model.
    label: fallbackName ? labels.followDefault(fallbackName) : labels.fallback,
    disabled: false,
    followDefault: true,
  })
  return options
}

// modelSelectLabel is what the trigger shows for the current selection. An
// override pointing at a model the mode no longer allows still needs a label:
// the sentinel would claim "no override" and a missing entry would leave the
// trigger blank, so it renders as the id.
export function modelSelectLabel(
  modelID: number | undefined,
  options: ModelSelectOption[],
  labels: ModelOptionLabels = { followDefault: (name) => `Follow default (${name})`, fallback: 'Default model' },
): { label: string; followDefault: boolean } {
  if (modelID === undefined) {
    const follow = options.find((option) => option.followDefault)
    return { label: follow?.label ?? labels.fallback, followDefault: true }
  }
  const match = options.find((option) => option.value === String(modelID))
  return { label: match ? match.label : `#${modelID}`, followDefault: false }
}
