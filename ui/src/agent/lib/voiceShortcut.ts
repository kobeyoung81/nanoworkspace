// The user's own dictation shortcut, per account and per browser.
//
// The platform offers a default (the `voice` component's `shortcut` item); this
// is the override, and it is a device property for the same reason the
// microphone gain is — a laptop and a tablet do not share a keyboard. It lives
// in client state, so it follows the signed-in account on this browser only.
//
// The override is tri-state and that is the point: nothing stored means "use the
// platform value", an explicitly empty value means "no shortcut", and anything
// else is the user's own key. resolveShortcut in lib/shortcut.ts applies it.
//
// Two surfaces touch it — the preferences tab writes it, the composer listens
// for it — and the composer stays mounted whether or not its panel is on screen,
// so a write has to reach the reader without a remount. Hence the small store:
// plain subscribe/getSnapshot functions for useSyncExternalStore.

import { clearState, readState, writeState } from './clientState'
import { normalizeShortcut } from './shortcut'

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * parseShortcutOverride reads a stored value: the user's canonical key, an empty
 * string for "turned off", or null when this browser holds nothing (and the
 * platform value should apply). A string that cannot name a shortcut is treated
 * as nothing rather than as a half-configured one — only the explicit empty
 * value turns the shortcut off.
 */
export function parseShortcutOverride(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }
  if (raw.trim() === '') {
    return ''
  }
  const normalized = normalizeShortcut(raw)
  return normalized === '' ? null : normalized
}

/** getShortcutOverride is the snapshot the composer renders and matches from. */
export function getShortcutOverride(): string | null {
  return readState<string | null>('voiceShortcut', undefined, parseShortcutOverride, null)
}

/** subscribeShortcutOverride lets a mounted composer hear about a write. */
export function subscribeShortcutOverride(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** writeShortcutOverride stores the user's key; an empty string turns it off. */
export function writeShortcutOverride(spec: string): void {
  writeState('voiceShortcut', undefined, normalizeShortcut(spec))
  notify()
}

/** clearShortcutOverride drops the override, so the platform value applies again. */
export function clearShortcutOverride(): void {
  clearState('voiceShortcut')
  notify()
}
