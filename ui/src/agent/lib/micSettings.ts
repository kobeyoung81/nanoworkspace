// The microphone's capture settings, per browser and per account.
//
// They are a device property rather than a platform one: a phone in a quiet room
// and a laptop beside a fan want different numbers, and one platform-wide value
// would be a compromise for both. The store is the app's client state, so the
// settings follow the signed-in account on this browser and nowhere else.
//
// Nothing here touches the DOM, so the parsing — the part that has to survive a
// half-written or hand-edited value — is testable.

import { readState, writeState } from './clientState'

/** Gain bounds: below 0.25 there is little left, above 8x the signal clips. */
export const MIN_GAIN = 0.25
export const MAX_GAIN = 8

export type MicSettings = {
  /** Linear multiplier applied before the samples are quantised to 16 bit. */
  gain: number
  // The browser's own DSP. It is not always a help for recognition — aggressive
  // noise suppression removes the quiet parts of speech along with the noise —
  // which is why each of them can be turned off here.
  autoGainControl: boolean
  noiseSuppression: boolean
  echoCancellation: boolean
}

/** The defaults reproduce the behaviour from before this setting existed. */
export const DEFAULT_MIC_SETTINGS: MicSettings = {
  gain: 1,
  autoGainControl: true,
  noiseSuppression: true,
  echoCancellation: true,
}

/** clampGain keeps a gain inside what the slider offers, and out of the absurd. */
export function clampGain(value: number): number {
  if (Number.isNaN(value)) {
    // A NaN gain would silence the microphone; there is nothing to clamp it to.
    return DEFAULT_MIC_SETTINGS.gain
  }
  if (value < MIN_GAIN) {
    return MIN_GAIN
  }
  if (value > MAX_GAIN) {
    return MAX_GAIN
  }
  return value
}

/** parseMicSettings reads a stored value, field by field, never throwing. */
export function parseMicSettings(value: unknown): MicSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_MIC_SETTINGS }
  }
  const record = value as Record<string, unknown>
  return {
    gain: clampGain(typeof record.gain === 'number' ? record.gain : Number(record.gain)),
    autoGainControl: boolValue(record.autoGainControl, DEFAULT_MIC_SETTINGS.autoGainControl),
    noiseSuppression: boolValue(record.noiseSuppression, DEFAULT_MIC_SETTINGS.noiseSuppression),
    echoCancellation: boolValue(record.echoCancellation, DEFAULT_MIC_SETTINGS.echoCancellation),
  }
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** readMicSettings returns what this browser has stored, or the defaults. */
export function readMicSettings(): MicSettings {
  return readState<MicSettings>('mic', undefined, (raw) => parseMicSettings(raw), {
    ...DEFAULT_MIC_SETTINGS,
  })
}

/** writeMicSettings stores the settings for this account on this browser. */
export function writeMicSettings(settings: MicSettings): void {
  writeState('mic', undefined, settings)
}
