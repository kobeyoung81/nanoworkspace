// The keyboard shortcut that starts and stops a dictation.
//
// A shortcut travels through three places — the platform config, the browser's
// client state, and a key event — so it is stored as one canonical string
// ("Alt+M", "Ctrl+Shift+M") that all three agree on. Everything here is a pure
// function of that string, which is what makes the parsing testable without a
// DOM and keeps the matching rules in one place.
//
// A shortcut must carry a "real" modifier (Ctrl, Alt or Meta): Shift+letter is
// just a capital letter, and a bare letter would swallow ordinary typing.

import { isLaidOut, type VisibleCheck } from './domLayout'

export type ShortcutEvent = {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export type Shortcut = { modifiers: Modifier[]; key: string }

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

/** The spellings people and configs actually use for each modifier. */
const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  super: 'Meta',
  win: 'Meta',
}

/** Named keys a shortcut may end with, spelled as KeyboardEvent.key does. */
const KEY_NAMES: Record<string, string> = {
  space: 'Space',
  ' ': 'Space',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
}
for (let n = 1; n <= 24; n += 1) {
  KEY_NAMES[`f${n}`] = `F${n}`
}

/** canonicalKey names the last token of a shortcut, or null when it is not a key. */
function canonicalKey(token: string): string | null {
  // A named key first: the space bar arrives as a single space character, which
  // would otherwise be read as the literal key " ".
  const named = KEY_NAMES[token.toLowerCase()]
  if (named) {
    return named
  }
  return token.length === 1 ? token.toUpperCase() : null
}

/**
 * parseShortcut reads a stored (or typed) string into its parts, or null when it
 * cannot name a usable shortcut.
 */
export function parseShortcut(spec: string): Shortcut | null {
  if (typeof spec !== 'string') {
    return null
  }
  const tokens = spec
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token !== '')
  if (tokens.length < 2) {
    return null
  }
  const modifiers: Modifier[] = []
  let key: string | null = null
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()]
    if (modifier) {
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier)
      }
      continue
    }
    if (key !== null) {
      // Two non-modifier tokens cannot both be the key.
      return null
    }
    key = canonicalKey(token)
    if (key === null) {
      return null
    }
  }
  if (key === null || !modifiers.some((m) => m === 'Ctrl' || m === 'Alt' || m === 'Meta')) {
    return null
  }
  return { modifiers, key }
}

function format(shortcut: Shortcut): string {
  const ordered = MODIFIER_ORDER.filter((modifier) => shortcut.modifiers.includes(modifier))
  return [...ordered, shortcut.key].join('+')
}

/** normalizeShortcut is the single spelling the store, config and matcher use. */
export function normalizeShortcut(spec: string): string {
  const parsed = parseShortcut(spec)
  return parsed ? format(parsed) : ''
}

/** matchesShortcut reports whether a key event is exactly this shortcut. */
export function matchesShortcut(spec: string, event: ShortcutEvent): boolean {
  const parsed = parseShortcut(spec)
  if (!parsed) {
    return false
  }
  const pressed: Record<Modifier, boolean> = {
    Ctrl: event.ctrlKey,
    Alt: event.altKey,
    Shift: event.shiftKey,
    Meta: event.metaKey,
  }
  // The modifiers must match exactly: an extra Ctrl held is a different gesture.
  for (const modifier of MODIFIER_ORDER) {
    if (parsed.modifiers.includes(modifier) !== pressed[modifier]) {
      return false
    }
  }
  const key = canonicalKey(event.key) ?? event.key.toUpperCase()
  return key === parsed.key
}

/**
 * shortcutFromEvent reads one key press as a shortcut, or null while it is only
 * modifiers (the capture keeps waiting) or carries no real modifier.
 */
export function shortcutFromEvent(event: ShortcutEvent): string | null {
  const key = canonicalKey(event.key)
  if (key === null || !(event.ctrlKey || event.altKey || event.metaKey)) {
    return null
  }
  const modifiers: Modifier[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Meta')
  return format({ modifiers, key })
}

const MAC_LABELS: Record<Modifier, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
const PC_LABELS: Record<Modifier, string> = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' }

/** shortcutLabel is the display form, in the platform's own symbols. */
export function shortcutLabel(spec: string, isMac: boolean): string {
  const parsed = parseShortcut(spec)
  if (!parsed) {
    return ''
  }
  const labels = isMac ? MAC_LABELS : PC_LABELS
  const ordered = MODIFIER_ORDER.filter((modifier) => parsed.modifiers.includes(modifier))
  return [...ordered.map((modifier) => labels[modifier]), parsed.key].join('+')
}

/**
 * isMacPlatform decides which modifier labels to draw. It is a separate
 * function so the label rule itself stays pure and testable.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

/**
 * resolveShortcut is the layering rule: a user override wins over the platform
 * value, and an explicit empty override (the user turned the shortcut off) means
 * no shortcut — it does not fall back to the platform's.
 */
export function resolveShortcut(
  userOverride: string | null | undefined,
  platform: string,
): string {
  const source = userOverride === null || userOverride === undefined ? platform : userOverride
  return normalizeShortcut(source)
}

/**
 * elementOnScreen reports whether an element is actually laid out. The workbench
 * keeps a panel it is not showing mounted inside a `display:none` vault, so the
 * composer of a hidden chat panel would otherwise still answer the shortcut and
 * record into a box nobody can see. The predicate itself lives in ./domLayout,
 * where the measuring code (auto-growing inputs) reads it too.
 */
export const elementOnScreen = isLaidOut

export type { VisibleCheck }
