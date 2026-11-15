// The decisions a socket makes about the conversation it is bound to.
//
// Both are pure so they can be pinned by a test: a reconnect that picks the
// wrong session id silently opens a *new* conversation, and a failed handshake
// that is mistaken for a vanished session wipes the tab. Neither mistake shows
// up in a type or a lint rule, and neither is reachable from a node test once it
// lives inside the socket callback.

/**
 * The session a socket must ask the gateway to resume.
 *
 * A fresh conversation keeps its tab's `sessionId` null for its whole life (the
 * tab only records the conversation key), so the id the server named on `ready`
 * is the only correct answer — the prop would send the reconnect in without a
 * session and the gateway would mint a brand-new conversation.
 */
export function resumeIDFor(current: string | null, prop: string | null): string | undefined {
  return current ?? prop ?? undefined
}

export type HandshakeVerdict = 'gone' | 'unreachable'

/**
 * What a failed handshake means. The browser hides the status code, so the only
 * evidence is the follow-up metadata read: "not found" is the one answer that
 * says the session itself is gone. Everything else — offline, a 502 while the
 * gateway restarts, a deploy in flight — is transient and must be retried.
 */
export function handshakeVerdict(message: string | null | undefined): HandshakeVerdict {
  return /not found/i.test(message ?? '') ? 'gone' : 'unreachable'
}
