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
