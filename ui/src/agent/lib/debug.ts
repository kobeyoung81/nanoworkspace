// Lightweight frontend diagnostics. Every channel logger tags output with a
// stable channel name and a monotonic timestamp so reconnect storms, WS drops
// and API failures are visible in the console. A shared log-storm limiter caps
// how much logging itself can emit, so a pathological loop can never freeze
// the tab by flooding the console (this was the failure mode of the terminal
// WS reconnect storm).

const DEBUG_FLAG = 'nanosec.portal.debug'

/** `1` turns the debug lines on; `trace` also lifts the log-storm limiter. */
export function debugEnabled(): boolean {
  try {
    const value = localStorage.getItem(DEBUG_FLAG)
    if (value === '1' || value === 'trace') {
      return true
    }
  } catch {
    // ignore
  }
  return import.meta.env.DEV
}

function traceEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_FLAG) === 'trace'
  } catch {
    return false
  }
}

// --- diagnostics ring buffer -------------------------------------------------
//
// A bounded, always-on record of the decisions that have no visible symptom
// until something breaks: which session a pane resolved, whether a history read
// was applied or discarded, when a socket was created and what it closed with.
// It never writes to the console by itself — `window.__diagDump()` reads it — so
// the cost on a healthy page is a few pushes per turn.

export type DiagEntry = { at: number; event: string; data?: Record<string, unknown> }

const DIAG_LIMIT = 200
const diagBuffer: DiagEntry[] = []
const diagStart = performance.now()

export function recordDiag(event: string, data?: Record<string, unknown>): void {
  try {
    diagBuffer.push({ at: Math.round(performance.now() - diagStart), event, ...(data ? { data } : {}) })
    if (diagBuffer.length > DIAG_LIMIT) {
      diagBuffer.splice(0, diagBuffer.length - DIAG_LIMIT)
    }
  } catch {
    // diagnostics must never break the interaction they observe
  }
}

/** The recent entries, oldest first. */
export function diagEntries(): readonly DiagEntry[] {
  return diagBuffer
}

/** One JSON object per line, for pasting into a report. */
export function diagText(): string {
  return diagBuffer.map((entry) => JSON.stringify(entry)).join('\n')
}

export type ChannelLogger = {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

// Shared log-storm limiter: >30 lines per 10s window silences all channels for
// the next 30s with a single explanatory message.
const STORM_LIMIT = 30
const STORM_WINDOW_MS = 10_000
const STORM_SILENCE_MS = 30_000

let stormWindowStart = 0
let stormCount = 0
let stormSilencedUntil = 0
let stormAnnounced = false
// How many lines the limiter swallowed. Reported when tracing resumes, because
// a silent gap in the console reads as "nothing happened" and cost us the
// evidence for a reconnect storm.
let stormDropped = 0

function allowWrite(): boolean {
  if (traceEnabled()) {
    return true
  }
  const now = performance.now()
  if (now < stormSilencedUntil) {
    stormDropped += 1
    return false
  }
  if (stormDropped > 0) {
    const dropped = stormDropped
    stormDropped = 0
    stormAnnounced = false
    console.warn(
      `[debug] ${dropped} log line(s) were suppressed during a ${STORM_SILENCE_MS / 1000}s window — tracing resumed`,
    )
  }
  if (now - stormWindowStart > STORM_WINDOW_MS) {
    stormWindowStart = now
    stormCount = 0
  }
  stormCount += 1
  if (stormCount <= STORM_LIMIT) {
    return true
  }
  if (!stormAnnounced) {
    stormAnnounced = true
    recordDiag('log.storm', { limit: STORM_LIMIT, windowMs: STORM_WINDOW_MS })
    console.error(`[debug] log storm detected (${STORM_LIMIT}+ lines/${STORM_WINDOW_MS / 1000}s) — suppressing console output for ${STORM_SILENCE_MS / 1000}s`)
  }
  stormSilencedUntil = now + STORM_SILENCE_MS
  return false
}

const start = performance.now()
const stamp = () => `+${Math.round(performance.now() - start)}ms`

export function createChannelLogger(channel: string): ChannelLogger {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]) => {
    if (!allowWrite()) {
      return
    }
    const prefix = `[${channel} ${stamp()}]`
    console[level](prefix, ...args)
  }

  return {
    debug: (...args: unknown[]) => {
      if (debugEnabled()) {
        write('debug', args)
      }
    },
    info: (...args: unknown[]) => write('info', args),
    warn: (...args: unknown[]) => write('warn', args),
    error: (...args: unknown[]) => write('error', args),
  }
}

export function installGlobalGuards(): void {
  window.addEventListener('error', (event) => {
    recordDiag('window.error', { message: event.message, source: event.filename, line: event.lineno })
    console.error('[global] uncaught error:', event.message, event.filename, `line ${event.lineno}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    recordDiag('window.rejection', { reason: String(event.reason) })
    console.error('[global] unhandled rejection:', event.reason)
  })
  installDiagnostics()
}

/**
 * Exposes the ring buffer on the page: `__diagDump()` prints it as a table,
 * `__diagText()` returns one JSON line per entry for a bug report. No console
 * output is produced until one of them is called.
 */
function installDiagnostics(): void {
  const target = window as unknown as Record<string, unknown>
  target.__diagDump = () => {
    console.table(diagBuffer)
    return diagBuffer.length
  }
  target.__diagText = () => diagText()
}