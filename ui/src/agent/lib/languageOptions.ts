// The languages the console offers, and their labels.
//
// Kept apart from `preferences.ts` (which pulls in the api client and therefore
// i18n) so this stays a plain data module tests can import.

// Each label is written in its own language, the way a language picker does it.
export const LANGUAGES = [
  { tag: 'zh', label: '简体中文' },
  { tag: 'en', label: 'English' },
  { tag: 'ja', label: '日本語' },
  { tag: 'ko', label: '한국어' },
  { tag: 'ru', label: 'Русский' },
  { tag: 'ar', label: 'العربية' },
  { tag: 'fr', label: 'Français' },
  { tag: 'de', label: 'Deutsch' },
  { tag: 'es', label: 'Español' },
  { tag: 'pt', label: 'Português' },
] as const

export type LanguageTag = (typeof LANGUAGES)[number]['tag']

/** An unknown tag is shown as written rather than hidden. */
export const languageLabel = (tag: string): string =>
  LANGUAGES.find((language) => language.tag === tag)?.label ?? tag
