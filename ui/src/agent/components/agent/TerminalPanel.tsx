import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Plus, SquareTerminal, X } from 'lucide-react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import '@xterm/xterm/css/xterm.css'
import { useTranslation } from 'react-i18next'
import { toast } from '../../lib/toast'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { attachTerminal, killTerminal, listTerminals, type TerminalSessionInfo } from '../../lib/api'
import { agentTerminalWsUrl } from '../../lib/agentApi'
import { useWorkbench } from '../../workbench/context'
import { useAgentResource } from '../../workbench/useAgentResource'
import { PluginFrame } from '../../workbench/plugin-frame'
import { useTheme } from '../../lib/theme'
import { ReconnectBackoff } from '../../lib/reconnect'
import { createChannelLogger } from '../../lib/debug'

const log = createChannelLogger('terminal')

// Degenerate PTY sizes (e.g. xterm's 2x1 floor while its canvas is detached
// during panel re-parenting) trip layout panics in TUI apps like opencode's
// welcome screen. Resizes at or below this floor are never forwarded to the
// PTY.
const MIN_COLS = 10
const MIN_ROWS = 4
// Coalesce resize bursts (floor + real + focus within one frame on switch-back)
// into a single PTY resize.
const RESIZE_DEBOUNCE_MS = 50
// Hold input very briefly after a panel re-shows so a freshly shown TUI can
// settle its layout before focus/keys arrive. Short enough that the old
// multi-frame stale-frame flash is gone; buffered input is still flushed.
const INPUT_HOLD_MS = 40
// Hover-motion SGR reports (DECSET 1003, button 35 = motion with no button)
// are coalesced to at most one per window, so a mouse sweep across the TUI
// cannot flood the PTY/WS bridge with hundreds of frames.
const MOUSE_MOTION_COALESCE_MS = 30

// The dock header and the status bar cannot reach the panel's internal state,
// so small module stores bridge them:
//  - newSession: routes the header's "+ new terminal" button to the panel body.
//  - termStatus: exposes connection + session count for the status bar.
const newSessionListeners = new Set<() => void>()
function subscribeNewSession(fn: () => void): () => void {
  newSessionListeners.add(fn)
  return () => newSessionListeners.delete(fn)
}
function emitNewSession(): void {
  for (const fn of newSessionListeners) {
    fn()
  }
}

type TermStatus = { connected: boolean; sessions: number }
let statusSnapshot: TermStatus = { connected: false, sessions: 0 }
let statusState: TermStatus = { connected: false, sessions: 0 }
const statusListeners = new Set<() => void>()
function publishStatus(patch: Partial<TermStatus>): void {
  const next = { ...statusState, ...patch }
  if (next.connected === statusState.connected && next.sessions === statusState.sessions) {
    return
  }
  statusState = next
  statusSnapshot = next
  for (const fn of statusListeners) {
    fn()
  }
}
function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

// terminalFrame mirrors the gateway <-> bus bridge wire protocol (base64 data).
type terminalFrame = {
  type: string
  terminal_id?: string
  data?: string
  cols?: number
  rows?: number
  message?: string
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes
}

// utf8ToBase64 encodes PTY input. The Go bridge's Data payload is []byte, which
// JSON encodes/decodes as base64 (matching the output direction); a raw string
// previously failed to decode and silently killed the bridge on the first key.
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i])
  }
  return btoa(bin)
}

// The SGR mouse report starts with ESC [ < (the control char is injected so
// the regex literal passes no-control-regex).
const ESC = String.fromCharCode(27)
const SGR_MOUSE_RE = new RegExp(`^${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])`)

// coalesceMouseMotion filters the PTY-bound input stream and collapses
// consecutive pure hover-motion SGR reports into a single "latest position"
// report per flushMs window. Everything else (keys, clicks, wheel, releases)
// is forwarded immediately, in order, relative to any pending motion. The
// encoder prefixes the button code with a 32 motion bit; a report with that
// bit and no button (b & 3 === 3) is a no-button hover, the high-rate event
// emitted while the pointer moves over a TUI with DECSET 1003 enabled.
function coalesceMouseMotion(flushMs: number, emit: (data: string) => void) {
  let buf = ''
  let latestMotion: string | null = null
  let timer: number | null = null

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }
  const flushMotion = () => {
    clearTimer()
    if (latestMotion !== null) {
      emit(latestMotion)
      latestMotion = null
    }
  }
  const scheduleMotion = () => {
    if (timer === null) {
      timer = window.setTimeout(flushMotion, flushMs)
    }
  }
  const emitPlain = (s: string) => {
    if (s) {
      flushMotion()
      emit(s)
    }
  }

  const process = () => {
    for (;;) {
      const idx = buf.indexOf('\x1b[<')
      if (idx === -1) {
        if (buf) {
          emitPlain(buf)
        }
        buf = ''
        return
      }
      if (idx > 0) {
        emitPlain(buf.slice(0, idx))
        buf = buf.slice(idx)
      }
      const m = SGR_MOUSE_RE.exec(buf)
      if (!m) {
        // Incomplete trailing report — hold it back until the rest of the
        // sequence arrives (xterm emits whole reports, so this only happens at
        // a chunk boundary). Cap the wait so a corrupt sequence can never wedge
        // input forever.
        if (buf.length < 32) {
          return
        }
        emitPlain(buf)
        buf = ''
        return
      }
      buf = buf.slice(m[0].length)
      const button = Number(m[1])
      const press = m[4] === 'M'
      const isHoverMotion = press && (button & 32) !== 0 && (button & 3) === 3
      if (isHoverMotion) {
        latestMotion = m[0]
        scheduleMotion()
      } else {
        flushMotion()
        emit(m[0])
      }
    }
  }

  return {
    push: (chunk: string) => {
      buf += chunk
      process()
    },
    dispose: () => {
      // Emit anything still held back (latest motion first, then partial plain
      // bytes) so no queued input is silently dropped on teardown.
      if (buf) {
        flushMotion()
        emit(buf)
        buf = ''
      } else {
        flushMotion()
      }
    },
  }
}

// readCssVar resolves a theme token from the document's computed style, trying
// both the raw and @theme-prefixed names. Tailwind 4 emits oklch() values,
// which Chromium accepts in canvas; hex fallbacks cover var-less environments.
function readCssVar(names: string[], fallback: string): string {
  try {
    const cs = getComputedStyle(document.documentElement)
    for (const name of names) {
      const value = cs.getPropertyValue(name).trim()
      if (value) {
        return value
      }
    }
  } catch {
    // ignore
  }
  return fallback
}

// buildXtermTheme maps the app's dark/light scheme to an xterm theme so the
// terminal matches the surrounding UI (previously it was hardcoded dark).
function buildXtermTheme(resolved: 'dark' | 'light'): ITheme {
  if (resolved === 'dark') {
    return {
      background: readCssVar(['--background', '--color-background'], '#0b0f14'),
      foreground: readCssVar(['--foreground', '--color-foreground'], '#d5dae2'),
      cursor: readCssVar(['--primary', '--color-primary'], '#6ba2e9'),
      selectionBackground: 'rgba(107,162,233,0.30)',
    }
  }
  // Light mode uses a tuned ANSI palette so mid-tone colors stay legible.
  return {
    background: readCssVar(['--background', '--color-background'], '#ffffff'),
    foreground: readCssVar(['--foreground', '--color-foreground'], '#0f172a'),
    cursor: readCssVar(['--primary', '--color-primary'], '#155dfc'),
    selectionBackground: 'rgba(21,93,252,0.18)',
    black: '#1e293b',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#e2e8f0',
    brightBlack: '#475569',
    brightRed: '#dc2626',
    brightGreen: '#16a34a',
    brightYellow: '#a16207',
    brightBlue: '#2563eb',
    brightMagenta: '#9333ea',
    brightCyan: '#0891b2',
    brightWhite: '#f8fafc',
  }
}

type TermRoute = {
  write: (bytes: Uint8Array) => void
  fit: () => { cols: number; rows: number } | null
  ready: boolean
}

// TerminalPanel is the PTY panel plugin (bottom slot by default). It is
// prop-free: agent/token come from the workbench context and the session list
// from useAgentResource.
export function TerminalPanel() {
  const { selectedAgent: agentId, token } = useWorkbench()
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const retryTimer = useRef<number | null>(null)
  const backoff = useRef(new ReconnectBackoff({ name: 'terminal' }))
  const routesRef = useRef(new Map<string, TermRoute>())
  const boundRef = useRef(new Set<string>())
  const idsRef = useRef<string[]>([])

  const {
    data,
    error: listError,
    loading: listLoading,
    refresh,
    setData,
  } = useAgentResource(
    agentId,
    useCallback((id: string) => listTerminals(id), []),
  )
  const terminalList = useMemo(() => data ?? [], [data])

  useEffect(() => {
    idsRef.current = terminalList.map((s) => s.terminal_id)
  }, [terminalList])

  // Mirror the panel state into the module store for the status bar.
  useEffect(() => {
    publishStatus({ connected, sessions: terminalList.length })
  }, [connected, terminalList.length])

  const sendFrame = useCallback((frame: terminalFrame) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame))
    }
  }, [])

  const resizeTimers = useRef(new Map<string, number>())
  // Last dimensions actually forwarded to the PTY, so a re-fit that lands on
  // the already-applied size (the common case when a hidden panel re-shows at
  // an unchanged dock size) never triggers a redundant TIOCSWINSZ/SIGWINCH.
  const lastSentSizeRef = useRef(new Map<string, { cols: number; rows: number }>())

  // sendResize is the only path that reaches the PTY with new dimensions. It
  // drops degenerate sizes, debounces bursts so a TUI receives at most one
  // sane resize per tick, and skips resizes to the size already applied.
  const sendResize = useCallback(
    (terminalId: string, cols: number, rows: number) => {
      if (cols < MIN_COLS || rows < MIN_ROWS) {
        return
      }
      const pending = resizeTimers.current.get(terminalId)
      if (pending !== undefined) {
        window.clearTimeout(pending)
      }
      resizeTimers.current.set(
        terminalId,
        window.setTimeout(() => {
          resizeTimers.current.delete(terminalId)
          const last = lastSentSizeRef.current.get(terminalId)
          if (last && last.cols === cols && last.rows === rows) {
            return
          }
          lastSentSizeRef.current.set(terminalId, { cols, rows })
          sendFrame({ type: 'resize', terminal_id: terminalId, cols, rows })
        }, RESIZE_DEBOUNCE_MS),
      )
    },
    [sendFrame],
  )

  // cancelResizeTimer drops a pending coalesced resize and the sent-size
  // bookkeeping once its session is gone, so a stale timer can never fire a
  // resize frame for a terminal that no longer exists.
  const cancelResizeTimer = useCallback((terminalId: string) => {
    const pending = resizeTimers.current.get(terminalId)
    if (pending !== undefined) {
      window.clearTimeout(pending)
      resizeTimers.current.delete(terminalId)
    }
    lastSentSizeRef.current.delete(terminalId)
  }, [])

  const bindAll = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        if (!boundRef.current.has(id)) {
          sendFrame({ type: 'bind', terminal_id: id })
          boundRef.current.add(id)
        }
      }
    },
    [sendFrame],
  )

  // resizeAll re-sends the current viewport size for every mounted session. It
  // runs on WebSocket open to heal any initial fit that happened while the
  // socket wasn't ready (the PTY otherwise stays at its 80x24 default until
  // the next manual resize).
  const resizeAll = useCallback(() => {
    routesRef.current.forEach((route, id) => {
      try {
        const r = route.fit()
        if (r && r.cols >= MIN_COLS && r.rows >= MIN_ROWS) {
          sendResize(id, r.cols, r.rows)
        }
      } catch {
        // container hidden or disposed — skip
      }
    })
  }, [sendResize])

  useEffect(() => {
    if (!agentId || !token) {
      return
    }
    let cancelled = false
    const connect = () => {
      // Never stack a second socket while one is live/connecting.
      const existing = wsRef.current
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return
      }
      const ws = new WebSocket(agentTerminalWsUrl(agentId, token))
      wsRef.current = ws
      ws.onopen = () => {
        backoff.current.reset()
        boundRef.current.clear()
        // Forget previously-applied sizes: the socket may have been down when a
        // resize was sent, so the first post-reconnect measurement must always
        // go through (resizeAll below re-issues the current viewport size).
        lastSentSizeRef.current.clear()
        bindAll(idsRef.current)
        // Heal any lost initial resize so the PTY matches the viewport (TUI
        // apps like opencode render at the PTY size — an unsynced 80x24 shows
        // as a small box until a manual panel resize).
        resizeAll()
        setConnected(true)
        setSessionError(null)
        log.info('open')
      }
      ws.onmessage = (event) => {
        if (cancelled) {
          return
        }
        let frame: terminalFrame
        try {
          frame = JSON.parse(event.data as string) as terminalFrame
        } catch {
          return
        }
        if (frame.type === 'output' && frame.terminal_id && frame.data) {
          const route = routesRef.current.get(frame.terminal_id)
          if (route && route.ready) {
            route.write(base64ToBytes(frame.data))
          }
        } else if (frame.type === 'closed' && frame.terminal_id) {
          cancelResizeTimer(frame.terminal_id)
          setData((prev: TerminalSessionInfo[] | null) => prev?.filter((s) => s.terminal_id !== frame.terminal_id) ?? [])
          boundRef.current.delete(frame.terminal_id)
          routesRef.current.delete(frame.terminal_id)
        } else if (frame.type === 'error' && frame.message) {
          setSessionError(frame.message)
        }
      }
      ws.onclose = (event) => {
        setConnected(false)
        log.info(`closed (code=${event.code}${event.reason ? `, after ${event.reason}` : ''})`)
        if (!cancelled && agentId) {
          retryTimer.current = window.setTimeout(connect, backoff.current.nextDelay())
        }
      }
    }
    connect()
    return () => {
      cancelled = true
      if (retryTimer.current) {
        window.clearTimeout(retryTimer.current)
        retryTimer.current = null
      }
      // Detach before closing so the close event cannot reschedule a retry
      // for a socket this effect no longer owns.
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
  }, [agentId, token, bindAll, resizeAll, setData, cancelResizeTimer])

  // Auto-create the first bash session when the agent has none. The in-flight
  // guard is a ref (no synchronous setState in the effect body); failures set a
  // cooldown so a persistently failing attach cannot hot-loop a retry.
  const creatingRef = useRef(false)
  const autoCreateBlockUntilRef = useRef(0)
  useEffect(() => {
    if (
      !agentId ||
      listLoading ||
      listError ||
      terminalList.length > 0 ||
      creatingRef.current ||
      Date.now() < autoCreateBlockUntilRef.current
    ) {
      return
    }
    creatingRef.current = true
    log.info('auto-creating first session')
    attachTerminal(agentId, { cols: 80, rows: 24 })
      .then((att) => {
        log.debug(`session created ${att.terminal_id}`)
        setData((prev: TerminalSessionInfo[] | null) => [...(prev ?? []), { terminal_id: att.terminal_id, agent_id: agentId, created_at: Date.now() }])
        setActiveId(att.terminal_id)
        sendFrame({ type: 'bind', terminal_id: att.terminal_id })
        boundRef.current.add(att.terminal_id)
      })
      .catch((err: Error) => {
        log.warn('auto-create failed', err.message)
        autoCreateBlockUntilRef.current = Date.now() + 10_000
        setSessionError(err.message)
        refresh()
      })
      .finally(() => {
        creatingRef.current = false
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, listLoading, listError, terminalList.length])

  const handleNew = useCallback(async () => {
    if (!agentId || creating) {
      return
    }
    setCreating(true)
    try {
      const att = await attachTerminal(agentId, { cols: 80, rows: 24 })
      log.info(`session created ${att.terminal_id}`)
      setData((prev: TerminalSessionInfo[] | null) => [...(prev ?? []), { terminal_id: att.terminal_id, agent_id: agentId, created_at: Date.now() }])
      setActiveId(att.terminal_id)
      sendFrame({ type: 'bind', terminal_id: att.terminal_id })
      boundRef.current.add(att.terminal_id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('terminal.createFailed'))
    } finally {
      setCreating(false)
    }
  }, [agentId, creating, sendFrame, t, setData])

  const handleClose = useCallback(
    async (terminalId: string) => {
      if (!agentId) {
        return
      }
      log.info(`session closed ${terminalId}`)
      cancelResizeTimer(terminalId)
      boundRef.current.delete(terminalId)
      try {
        await killTerminal(agentId, terminalId)
      } catch {
        // The session may already be gone (e.g. bash exited).
      }
      setData((prev: TerminalSessionInfo[] | null) => prev?.filter((s) => s.terminal_id !== terminalId) ?? [])
      setActiveId((prev) => (prev === terminalId ? null : prev))
    },
    [agentId, setData, cancelResizeTimer],
  )

  // Header "new session" button (rendered by the dock header) routes here.
  useEffect(() => subscribeNewSession(handleNew), [handleNew])

  const registerRoute = useCallback((id: string, route: TermRoute) => {
    routesRef.current.set(id, route)
  }, [])

  const unregisterRoute = useCallback((id: string) => {
    routesRef.current.delete(id)
  }, [])

  const activate = useCallback(
    (id: string) => {
      setActiveId(id)
      sendFrame({ type: 'bind', terminal_id: id })
      boundRef.current.add(id)
    },
    [sendFrame],
  )

  // Never leave the terminal with no selected session: derive the effective
  // active session at render (explicit selection wins, otherwise the first
  // loaded session). This covers page refresh, plugin re-display and the
  // active session being closed, without a setState-in-effect. The active
  // TermView binds itself on mount below.
  const activeTerminalId =
    (activeId && terminalList.some((s) => s.terminal_id === activeId) ? activeId : terminalList[0]?.terminal_id) ?? null

  if (!agentId || !token) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-4 text-sm text-muted-foreground">
        {t('terminal.noSessions')}
      </div>
    )
  }

  const sessionSidebar = (
    <aside className="flex w-fit shrink-0 flex-col border-l bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {terminalList.map((s, index) => (
          <div
            key={s.terminal_id}
            className={cn(
              'group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs',
              s.terminal_id === activeTerminalId ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <button type="button" onClick={() => activate(s.terminal_id)} className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-left">
              <SquareTerminal className="h-3.5 w-3.5 shrink-0" />
              <span>{t('terminal.session', { n: index + 1 })}</span>
            </button>
            <button
              type="button"
              onClick={() => handleClose(s.terminal_id)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('terminal.close')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )

  return (
    <PluginFrame
      busy={listLoading && terminalList.length === 0}
      error={sessionError}
      onRetry={() => {
        setSessionError(null)
        bindAll(idsRef.current)
      }}
    >
      <div className="flex h-full min-h-0 flex-row">
        <div className="relative min-h-0 min-w-0 flex-1 bg-background">
          {terminalList.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <SquareTerminal className="h-4 w-4" />
              {t('terminal.noSessions')}
            </div>
          ) : null}
          {terminalList.map((s) => (
            <TermView
              key={s.terminal_id}
              agentId={agentId}
              sessionId={s.terminal_id}
              active={s.terminal_id === activeTerminalId}
              resolvedTheme={resolvedTheme}
              sendFrame={sendFrame}
              sendResize={sendResize}
              registerRoute={registerRoute}
              unregisterRoute={unregisterRoute}
            />
          ))}
        </div>
        {terminalList.length > 1 ? sessionSidebar : null}
      </div>
    </PluginFrame>
  )
}

// TerminalHeaderActions is the "new terminal" icon button contributed to the
// dock header. State routes to the panel body via the module bus.
export function TerminalHeaderActions() {
  const { t } = useTranslation()
  const { selectedAgent } = useWorkbench()
  if (!selectedAgent) {
    return null
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={emitNewSession}
      aria-label={t('terminal.new')}
      title={t('terminal.new')}
    >
      <Plus className="h-3.5 w-3.5" />
    </Button>
  )
}

// TerminalStatusBar contributes the connection + session count line to the
// bottom status bar (bottom dock section). Reads the module store the panel
// keeps in sync.
export function TerminalStatusBar() {
  const { t } = useTranslation()
  const status = useSyncExternalStore(subscribeStatus, () => statusSnapshot)
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', status.connected ? 'bg-success' : 'bg-warning')} />
      {status.connected ? t('terminal.connected') : t('terminal.disconnected')}
      {status.sessions > 0 ? <span>{t('terminal.sessionCount', { n: status.sessions })}</span> : null}
    </span>
  )
}

function TermView({
  agentId,
  sessionId,
  active,
  resolvedTheme,
  sendFrame,
  sendResize,
  registerRoute,
  unregisterRoute,
}: {
  agentId: string
  sessionId: string
  active: boolean
  resolvedTheme: 'dark' | 'light'
  sendFrame: (frame: terminalFrame) => void
  sendResize: (terminalId: string, cols: number, rows: number) => void
  registerRoute: (id: string, route: TermRoute) => void
  unregisterRoute: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const wasVisibleRef = useRef(false)
  const everVisibleRef = useRef(false)
  const inputHoldRef = useRef<{ until: number; chunks: string[] } | null>(null)
  const focusTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) {
      return
    }
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      allowProposedApi: true,
      theme: buildXtermTheme(resolvedTheme),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // OSC 52 clipboard integration so TUI copies (e.g. opencode's "copied to
    // clipboard") land in the browser/host clipboard instead of being dropped.
    term.loadAddon(new ClipboardAddon())
    term.open(el)
    // Route PTY input through the mouse-motion coalescer, which collapses
    // hover-motion floods into a single latest-position report per window so a
    // pointer sweep cannot bury the TUI in SGR frames.
    const mouseCoalescer = coalesceMouseMotion(MOUSE_MOTION_COALESCE_MS, (data) => {
      const hold = inputHoldRef.current
      if (hold && Date.now() < hold.until) {
        hold.chunks.push(data)
        return
      }
      if (hold) {
        inputHoldRef.current = null
      }
      sendFrame({ type: 'input', terminal_id: sessionId, data: utf8ToBase64(data) })
    })
    term.onData((data) => mouseCoalescer.push(data))
    term.onResize(({ cols, rows }) => sendResize(sessionId, cols, rows))

    const route: TermRoute = {
      write: (bytes) => term.write(bytes),
      fit: () => {
        fit.fit()
        return { cols: term.cols, rows: term.rows }
      },
      ready: false,
    }
    registerRoute(sessionId, route)
    // Self-bind when this view becomes the active one (sendFrame no-ops if the
    // bridge is not open yet; bindAll on open covers the rest). This makes an
    // auto-selected first session stream output without a manual click.
    if (active) {
      sendFrame({ type: 'bind', terminal_id: sessionId })
    }
    termRef.current = term
    fitRef.current = fit

    // Fit BEFORE attaching so the REST attach carries the real dimensions —
    // the server applies pty.Setsize on attach, fixing the initial size even
    // when the WebSocket is not open yet (xterm's 80x24 default otherwise
    // leaves the PTY small until a later resize event). If the container is
    // hidden (zero size) fit keeps the fallback dims.
    routesNow(fitRef.current, termRef.current)

    let disposed = false
    let retryTimer: number | null = null
    const applyAttachment = (att: Awaited<ReturnType<typeof attachTerminal>>) => {
      if (disposed) {
        return
      }
      if (att.replay) {
        term.write(base64ToBytes(att.replay))
      }
      route.ready = true
      // Diagnostics: a fresh xterm should be on the alt screen with mouse
      // tracking when a TUI is running; a mismatch means replay mode-restore
      // did not apply (would break wheel containment).
      log.debug(
        `session ${sessionId} attached (replay ${att.replay ? att.replay.length : 0}B, ` +
          `buffer ${term.buffer.active.type}, mouse ${term.modes.mouseTrackingMode})`,
      )
    }
    const attach = (attempt: number) => {
      // Never send a degenerate size over REST attach: a mount-time fit while
      // the panel is mid-layout can land on xterm's 2x1 floor, which crashes
      // TUI apps like opencode. Fall back to the sane default; the WS resize
      // path owns the real size once the panel is visible.
      const cols = term.cols >= MIN_COLS ? term.cols : 80
      const rows = term.rows >= MIN_ROWS ? term.rows : 24
      attachTerminal(agentId, { terminal_id: sessionId, cols, rows })
        .then(applyAttachment)
        .catch((err: Error) => {
          if (disposed) {
            return
          }
          if (attempt < 3) {
            // The hypervisor tunnel can be mid-reconnect; retry so the replay
            // (which re-arms the TUI's DEC modes) is always applied. Never mark
            // the route ready without replay: that leaves xterm in the normal
            // buffer with tracking off while the TUI believes it is armed.
            retryTimer = window.setTimeout(() => attach(attempt + 1), 400 * attempt)
            return
          }
          log.warn(`session ${sessionId} attach failed after retries`, err.message)
          route.ready = true
        })
    }
    attach(1)

    return () => {
      disposed = true
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
      }
      // Flush any coalesced/held-back input before tearing the terminal down.
      mouseCoalescer.dispose()
      unregisterRoute(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, agentId])

  useEffect(() => {
    // Keep the xterm palette in sync with the app theme (runtime swap).
    if (termRef.current) {
      termRef.current.options.theme = buildXtermTheme(resolvedTheme)
    }
  }, [resolvedTheme])

  useEffect(() => {
    if (!active) {
      return
    }
    // Reset the visibility-transition tracker whenever the session is
    // activated, so the first visible measurement focuses the terminal again.
    wasVisibleRef.current = false

    let rafId = 0
    let ro: ResizeObserver | null = null

    const measureAndSettle = () => {
      const root = rootRef.current
      const visible = Boolean(root && root.clientWidth > 0 && root.clientHeight > 0 && root.offsetParent !== null)
      if (!visible) {
        // Hidden (own .hidden, a collapsed dock, or the workbench vault):
        // never fit or resize while detached — a fit here would measure a
        // degenerate box. Mark the transition so the next visible measurement
        // runs the full re-show path.
        wasVisibleRef.current = false
        return
      }
      const r = routesNow(fitRef.current, termRef.current)
      if (!r || r.cols < MIN_COLS || r.rows < MIN_ROWS) {
        return
      }
      const reShown = !wasVisibleRef.current
      wasVisibleRef.current = true
      sendResize(sessionId, r.cols, r.rows)
      if (!reShown) {
        return
      }
      const term = termRef.current
      if (!term) {
        return
      }
      // Re-attached after a hide: the reflow can leave the xterm viewport
      // scrolled off the live screen, surfacing as a stale partial frame until
      // the app repaints. Snap to the bottom so the buffer matches instantly
      // instead of flashing for the input-hold window.
      term.scrollToBottom()
      if (everVisibleRef.current) {
        // Re-show after a hide: hold input very briefly so a freshly shown TUI
        // can settle its layout before focus/keys arrive. Buffered input is
        // flushed when the hold expires.
        inputHoldRef.current = { until: Date.now() + INPUT_HOLD_MS, chunks: [] }
        focusTimerRef.current = window.setTimeout(() => {
          const hold = inputHoldRef.current
          inputHoldRef.current = null
          if (hold) {
            for (const chunk of hold.chunks) {
              sendFrame({ type: 'input', terminal_id: sessionId, data: utf8ToBase64(chunk) })
            }
          }
          term.focus()
        }, INPUT_HOLD_MS)
      } else {
        log.debug(`session ${sessionId} became visible — focusing`)
        term.focus()
      }
      everVisibleRef.current = true
    }

    // ResizeObserver can fire every frame during a dock re-parent / re-show
    // transition; coalesce the (re)measure into one per animation frame.
    const scheduleMeasure = () => {
      if (rafId !== 0) {
        return
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        measureAndSettle()
      })
    }

    // Initial measurement as soon as the session becomes active.
    scheduleMeasure()
    ro = new ResizeObserver(scheduleMeasure)
    if (rootRef.current) {
      ro.observe(rootRef.current)
    }
    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }
      ro?.disconnect()
    }
  }, [active, sessionId, sendResize, sendFrame])

  return (
    <div
      ref={rootRef}
      // overscroll-contain keeps a wheel event that xterm does not consume
      // (untracked, empty buffer) from chaining/scroll-jacking the page.
      className={cn('absolute inset-0 overscroll-contain', active ? 'block' : 'hidden')}
    >
      <div ref={containerRef} className="h-full w-full p-1" />
    </div>
  )
}

function routesNow(fit: FitAddon | null, term: Terminal | null): { cols: number; rows: number } | null {
  if (!fit || !term) {
    return null
  }
  try {
    fit.fit()
    return { cols: term.cols, rows: term.rows }
  } catch {
    return null
  }
}

export type { TerminalSessionInfo }