// "Has this conversation changed since I last looked at it?"
//
// Both sides of the comparison are server timestamps: the snapshot's
// `updated_at` and the value this browser recorded when it last read the
// conversation. Using the local clock would make a slow or fast browser show
// unread badges for messages it had already seen.

/** True when the conversation was updated after the last read. */
export function isUnread(updatedAt: string, readAt: string | undefined): boolean {
  if (!updatedAt || !readAt) {
    return false
  }
  const updated = Date.parse(updatedAt)
  const read = Date.parse(readAt)
  if (!Number.isFinite(updated) || !Number.isFinite(read)) {
    return false
  }
  return updated > read
}

/**
 * True when the conversation changed after this browser's baseline.
 *
 * The baseline is captured once, on the first snapshot a browser ever sees, and
 * stands for "everything that already existed is read". A conversation with no
 * `readAt` entry that is newer than that is therefore new work the user has not
 * looked at — a chat started on another device, or a fresh conversation that
 * opened in a background tab. Treating every unseen key as read (the old rule)
 * swallowed exactly those.
 */
export function unreadSinceBaseline(updatedAt: string, baseline: string | undefined): boolean {
  if (!updatedAt || !baseline) {
    return false
  }
  const updated = Date.parse(updatedAt)
  const base = Date.parse(baseline)
  if (!Number.isFinite(updated) || !Number.isFinite(base)) {
    return false
  }
  return updated > base
}
