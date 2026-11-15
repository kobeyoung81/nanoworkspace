import { createChannelLogger } from './debug'

type BackoffOptions = {
  name: string
  baseMs?: number
  maxMs?: number
}

const DEFAULT_BASE_MS = 1000
const DEFAULT_MAX_MS = 30_000
const STORM_THRESHOLD = 6
const STORM_WINDOW_MS = 30_000

// ReconnectBackoff returns escalating delays for WebSocket retries with ±20%
// jitter, capped at maxMs. All state is in-memory: a browser refresh always
// creates a fresh instance, so the first attempt after a page load is
// immediate and storm state never survives a reload.
export class ReconnectBackoff {
  private readonly baseMs: number
  private readonly maxMs: number
  private readonly log: ReturnType<typeof createChannelLogger>
  private attempt = 0
  private failures: number[] = []
  private stormAnnounced = false

  constructor(opts: BackoffOptions) {
    this.baseMs = opts.baseMs ?? DEFAULT_BASE_MS
    this.maxMs = opts.maxMs ?? DEFAULT_MAX_MS
    this.log = createChannelLogger(`reconnect:${opts.name}`)
  }

  // reset clears failure/storm state; call on a successful OPEN.
  reset(): void {
    this.attempt = 0
    this.failures = []
    this.stormAnnounced = false
  }

  // nextDelay records a failure and returns the delay before the next attempt.
  nextDelay(): number {
    const now = Date.now()
    this.failures = this.failures.filter((t) => now - t <= STORM_WINDOW_MS)
    this.failures.push(now)

    if (this.failures.length >= STORM_THRESHOLD) {
      if (!this.stormAnnounced) {
        this.stormAnnounced = true
        this.log.error(
          `reconnect storm detected (${this.failures.length} failures/${STORM_WINDOW_MS / 1000}s) — pinning delay at ${this.maxMs}ms; restore the backend or refresh the page to reset`,
        )
      }
      return this.jitter(this.maxMs)
    }

    const delay = Math.min(this.baseMs * 2 ** this.attempt, this.maxMs)
    this.attempt += 1
    this.log.info(`connection lost — retrying in ${delay}ms (attempt ${this.attempt})`)
    return this.jitter(delay)
  }

  private jitter(delay: number): number {
    const jitter = delay * 0.2 * (Math.random() * 2 - 1)
    return Math.round(Math.max(200, delay + jitter))
  }
}