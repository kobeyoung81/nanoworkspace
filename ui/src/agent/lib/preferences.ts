// The account's reply language, and the platform default it inherits.
//
// Server-backed (unlike the dictation shortcut, which is a device property):
// the language has to hold on every channel the account talks through, not just
// in this browser.

import { fetchJson, putJson } from './api'

export type LanguageSource = 'platform' | 'user'

export type LanguagePreference = {
  /** The effective language tag ("zh", "en", …). */
  language: string
  /** Which level it came from. */
  source: LanguageSource
}

// The language list lives in languageOptions.ts so tests can import it without
// dragging in the api client.
export { LANGUAGES, languageLabel, type LanguageTag } from './languageOptions'

export const getPreferences = (userID: string) =>
  fetchJson<LanguagePreference>(`/preferences?user_id=${encodeURIComponent(userID)}`, '/api/user/v1')

export const savePreferences = (userID: string, language: string) =>
  putJson<LanguagePreference>('/preferences', { user_id: userID, language }, '/api/user/v1')
