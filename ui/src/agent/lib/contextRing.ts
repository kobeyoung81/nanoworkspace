// Where the status bar's context ring draws its compaction threshold.
//
// The agent measures the next request against a prompt budget and fires
// auto-compaction at a percentage of it — a percentage that is configurable per
// agent type. The ring used to compute the marker as a hard-coded 75 % of that
// budget, so as soon as the platform's setting was anything else the marker
// lied: the ring crossed it while the gate had not fired yet, which reads as
// "auto-compaction is broken". The marker now comes from the threshold the
// agent reports with each usage event; the 75 % fallback only covers a client
// talking to an agent too old to send one.
//
// The numbers are token counts on the same scale as `limit` (the context
// window), so the marker is just their ratio.

const FALLBACK_TRIGGER_SHARE = 0.75

/** Share of the ring where the agent's gate fires, or undefined when unknowable. */
export function compactThresholdPct(usage: {
  threshold?: number
  budget?: number
  limit?: number
}): number | undefined {
  const { limit } = usage
  if (typeof limit !== 'number' || limit <= 0) {
    return undefined
  }
  const threshold = usage.threshold ?? (typeof usage.budget === 'number' ? usage.budget * FALLBACK_TRIGGER_SHARE : undefined)
  if (typeof threshold !== 'number') {
    return undefined
  }
  return Math.max(0, Math.min(100, (threshold * 100) / limit))
}
