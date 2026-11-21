// Whether the chat socket is still alive, and when to ask before trusting it.
//
// A browser cannot observe the WebSocket ping/pong control frames (they are
// handled below the API), so a connection whose network died stays `OPEN` from
// the page's point of view: writes go into the void and no frame ever arrives.
// That is why "I had to refresh before I could send" happens. The only honest
// answer is an application-level probe: the page writes `{"type":"ping"}`, the
// gateway answers `{"type":"pong"}`, and silence for a few seconds means the
// socket is dead.
//
// The numbers are chosen for a phone waking up on a slow network: 15 s between
// heartbeats keeps an idle socket honest, 10 s of silence before a send is worth
// one probe (a probe on a healthy socket costs one round trip), and 3 s is long
// enough for a bad mobile network and short enough to feel immediate.

/** How often an idle connection proves itself. */
export const HEARTBEAT_INTERVAL_MS = 15_000

/** Silence after which a send is preceded by a probe. */
export const SEND_PROBE_IDLE_MS = 10_000

/** How long a probe may stay unanswered before the socket is declared dead. */
export const PROBE_TIMEOUT_MS = 3_000

/** Whether an idle socket should send a heartbeat now. */
export function heartbeatDue(now: number, lastInboundAt: number, intervalMs = HEARTBEAT_INTERVAL_MS): boolean {
  // A clock that went backwards (or a fresh mount) must not read as "due
  // forever": treat a non-positive gap as due once, which is harmless.
  const silence = now - lastInboundAt
  return silence < 0 || silence >= intervalMs
}

/** Whether a write should be held until a probe answers. */
export function needsProbeBeforeSend(now: number, lastInboundAt: number, idleMs = SEND_PROBE_IDLE_MS): boolean {
  const silence = now - lastInboundAt
  return silence < 0 || silence >= idleMs
}

/** Whether a probe sent at `probeSentAt` has gone unanswered (0 = none in flight). */
export function probeTimedOut(now: number, probeSentAt: number, timeoutMs = PROBE_TIMEOUT_MS): boolean {
  if (probeSentAt <= 0) {
    return false
  }
  return now - probeSentAt >= timeoutMs
}
