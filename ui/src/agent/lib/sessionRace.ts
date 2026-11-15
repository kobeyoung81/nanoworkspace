// The outcome of an access-token refresh, and the one comparison that keeps two
// tabs from tripping over each other.
//
// Refresh tokens are single-use: the server revokes the ticket it was given and
// issues a successor. Every tab of a browser shares one session in
// localStorage, so a second tab refreshing with the same ticket gets a 401 even
// though the first tab succeeded. That 401 means "somebody else already did it",
// not "the credentials are dead", and only the second reading may clear the
// session.

export type RefreshOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-session' | 'rejected' | 'transient' }

// refreshTokenChanged reports whether the stored session now holds a different
// refresh token than the one this attempt started with — i.e. another tab (or
// another sign-in) has already replaced it.
export function refreshTokenChanged(
  startedWith: string,
  current: { refresh_token?: string } | null,
): boolean {
  if (!current?.refresh_token) {
    return false
  }
  return current.refresh_token !== startedWith
}

// isRejection is true only when the server definitively refused the ticket.
// Network errors and 5xx are 'transient' and must not sign the user out (a
// portal restart during a deploy used to do exactly that).
export function isRejection(outcome: RefreshOutcome): boolean {
  return !outcome.ok && outcome.reason === 'rejected'
}
