// How long a goal has been running, for the two places that show it.

/** minutesSince is whole minutes from `startISO` to `nowISO` (never negative).
 *
 * A goal that has just started reads "0 分钟" rather than a negative or a NaN;
 * an unparsable timestamp behaves the same way instead of throwing in a render.
 */
export function minutesSince(startISO: string | undefined, nowISO: string | number = Date.now()): number {
  if (!startISO) return 0
  const start = new Date(startISO).getTime()
  const now = typeof nowISO === 'number' ? nowISO : new Date(nowISO).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 0
  return Math.max(0, Math.round((now - start) / 60000))
}
