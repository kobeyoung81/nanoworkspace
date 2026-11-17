import { useCallback, useEffect, useRef, useState } from 'react'
import { agentWsUrl, type AgentEvent } from '../lib/agentApi'
import { ReconnectBackoff } from '../lib/reconnect'
import { createChannelLogger, recordDiag } from '../lib/debug'
import { readRawState, writeRawState } from '../lib/clientState'
import { conversationModeOf } from '../lib/agentMode'
import { appendLiveChunk, ensureCompactionDivider, finalizeBlocks, patchCompactionSummary, patchFinalAnswer } from './liveMessages'
import { COMPACTION_SILENCE_BUDGET_MS, turnLooksAlive } from './turnState'
import { mergeSegment, nextSegmentToRead, prependSegment } from './segmentMerge'
import { handshakeVerdict, resumeIDFor } from '../lib/sessionResume'
import i18n from '../i18n'
import type { SessionMetaSnapshot } from '../lib/sessionMeta'

const log = createChannelLogger('chat')

export type AgentToolEntry = { name: string; args: string; result: string }

// TaskProgress is one delegated subagent that is still running. It comes from a
// "status" chunk whose payload event is "task_progress", and it disappears once
// that task reports done or error.
export type TaskProgress = {
  id: string
  description: string
  /** started | thinking | tool */
  state: string
  detail?: string
}

export type AgentMode = 'build' | 'plan'

export type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority?: string
}

export type QuestionOption = { label: string; description?: string }

export type QuestionSpec = {
  question: string
  header?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type PendingQuestion = { id: string; questions: QuestionSpec[] }

// PendingApproval is a permission prompt for a gated tool. It is distinct from
// a question: the portal renders a dedicated approval card showing the tool and
// the specific call detail (e.g. the bash command).
export type PendingApproval = {
  id: string
  tool: string
  type_id?: string
  summary?: string
  arguments?: string
}

// PermissionDecision is the user's answer to a PendingApproval.
export type PermissionDecision = 'allow_once' | 'always_allow' | 'deny'

// `budget` is the prompt budget auto-compaction triggers against (context
// window minus the output reservation) and `threshold` is the token count the
// agent's gate actually fires at, so the ring draws the server's threshold
// rather than a percentage of its own (see lib/contextRing.ts).
export type ContextUsage = { used: number; limit: number; pct: number; budget?: number; threshold?: number }

// LoadedSegment is one persisted conversation segment: exactly one row of
// agent_sessions, read whole. History is a chain of these — a compaction or
// /new archives the current row and continues in a new version — linked
// backwards by `previousSessionId` (meta.handoff_from). Reading the whole row
// instead of a page of N messages keeps the client model simple: one segment is
// one request, so a conversation compacted k times costs k+1 requests in total.
export type LoadedSegment = {
  sessionId: string
  messages: AgentMessage[]
  /** The segment a compaction (or /new) archived before this one, if any. */
  previousSessionId: string | null
  turnRunning: boolean
  /** The server reports a compaction in flight for this segment. */
  compacting?: boolean
  /** The mode this segment last ran in (its `_session_agent`), or null when it
   * has none yet. Only meaningful on a segment whose body was read: a 304 leaves
   * it undefined so an untouched transcript cannot clear a known mode. */
  mode?: AgentMode | null
  todos?: TodoItem[]
  pendingQuestion?: PendingQuestion | null
  pendingApproval?: PendingApproval | null
  /** Validator of this read, replayed when the segment is read again. */
  etag?: string
  /** True when the server answered 304: the caller's copy is already current. */
  notModified?: boolean
}

export type AgentMessage =
  /** `pending` marks a user message that has been sent but is not in the stored
   * history yet. It is kept at the end of the transcript until the persisted
   * segment contains it, so a history refresh cannot make it vanish. */
  | { id: string; role: 'user'; content: string; streaming: false; mode?: AgentMode; pending?: boolean }
  | { id: string; role: 'assistant'; kind: 'content'; content: string; streaming: boolean }
  | {
      id: string
      role: 'assistant'
      kind: 'thought'
      content: string
      streaming: boolean
      startedAt: number
      elapsedMs?: number
    }
  | { id: string; role: 'assistant'; kind: 'tool_group'; tools: AgentToolEntry[]; streaming: boolean; folded: boolean }
  | {
      id: string
      role: 'assistant'
      kind: 'question'
      /** The `question` call's arguments verbatim (see lib/questionRecord). */
      args: string
      /** The tool result: a JSON array with one answer per question. */
      result: string
      /** Waiting for an answer — the answer frame clears it. */
      streaming: boolean
    }
  | { id: string; role: 'assistant'; kind: 'error'; category: string; detail: string; streaming: false }
  | { id: string; role: 'assistant'; kind: 'stopped'; streaming: false }
  | { id: string; role: 'assistant'; kind: 'compaction'; summary: string; streaming: boolean }

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `msg-${Date.now()}-${idCounter}`
}

// Context usage is persisted per agent so the status-bar ring is visible from
// the first paint (before the next turn emits a fresh usage event).
function readStoredContextUsage(agentId: string | null): ContextUsage | null {
  if (!agentId) {
    return null
  }
  try {
    const raw = readRawState('contextUsage', agentId)
    if (!raw) {
      return null
    }
    const v = JSON.parse(raw) as Partial<ContextUsage>
    if (typeof v?.used === 'number' && typeof v?.limit === 'number' && typeof v?.pct === 'number') {
      return {
        used: v.used,
        limit: v.limit,
        pct: v.pct,
        budget: typeof v.budget === 'number' ? v.budget : undefined,
        threshold: typeof v.threshold === 'number' ? v.threshold : undefined,
      }
    }
  } catch {
    // ignore malformed/absent storage
  }
  return null
}

function writeStoredContextUsage(agentId: string | null, usage: ContextUsage): void {
  if (!agentId) {
    return
  }
  try {
    writeRawState('contextUsage', agentId, JSON.stringify(usage))
  } catch {
    // ignore storage failures (private mode/quota)
  }
}

const MAX_RECONNECT_DELAY = 30_000
const INITIAL_RECONNECT_DELAY = 1_000
const MAX_PENDING_SENDS = 50
// MAX_HISTORY_SEGMENT_HOPS bounds how many archived segments may be stitched
// together, so a malformed handoff chain cannot loop.
const MAX_HISTORY_SEGMENT_HOPS = 50
// Cadence and quiet threshold of the turn-state reconciliation (see below).
const RUNNING_RECONCILE_MS = 5_000
const RUNNING_QUIET_MS = 5_000

// Cross-pane gate for segment reads: restoring several tabs walks several
// segment chains at once, and this keeps the history endpoint from being hit by
// every tab simultaneously.
const SEGMENT_CONCURRENCY = 2
let segmentActive = 0
const segmentQueue: (() => void)[] = []

function withSegmentSlot<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      segmentActive += 1
      run()
        .then(resolve, reject)
        .finally(() => {
          segmentActive -= 1
          const next = segmentQueue.shift()
          if (next) {
            next()
          }
        })
    }
    if (segmentActive < SEGMENT_CONCURRENCY) {
      start()
      return
    }
    segmentQueue.push(start)
  })
}

// ChatMediaItem is an attachment reference sent with a user message. Image
// bytes are uploaded separately (file API); only the reference travels over the
// WebSocket.
export type ChatMediaItem = {
  platform?: string
  media_id?: string
  filename?: string
  mime_type?: string
  url?: string
}

// mediaDisplay is the placeholder shown in the optimistic user bubble when a
// message carries attachments but no text.
function mediaDisplay(media: ChatMediaItem[]): string {
  return media.map((m) => m.filename || 'attachment').join(', ')
}

/**
 * useAgent manages a WebSocket conversation against a gateway web channel.
 *
 * - Inbound user messages are shown immediately, even while the socket is down;
 *   they stay in the transcript until the stored history confirms them.
 * - Assistant replies stream in as chunk events and are finalized on complete.
 * - When `sessionId` is provided the connection resumes that conversation.
 *   History is read one segment (= one agent_sessions row) at a time and the
 *   chain of older segments is walked in the background, so scrolling up needs
 *   no request.
 * - Drops reconnect with capped exponential backoff; messages typed while
 *   disconnected are queued and flushed on reconnect.
 * - If the handshake is rejected (e.g. a stale session id), `onSessionInvalid`
 *   is called so the caller can fall back to a fresh conversation.
 */
export function useAgent(
  gatewayUrl: string,
  token: string,
  agentId: string | null,
  sessionId: string | null,
  loadSegment?: (sessionId: string, etag?: string) => Promise<LoadedSegment>,
  onSessionInvalid?: () => void,
  onTurnComplete?: () => void,
  onSessionChanged?: (sessionId: string) => void,
  // loadSessionMeta reads just the small mutable part of a session, used to
  // reconcile todos / a pending question / the running flag without touching the
  // transcript.
  loadSessionMeta?: (sessionId: string) => Promise<SessionMetaSnapshot>,
  // resolvePreviousSegment infers the segment a stored row does not name itself.
  // meta.handoff_from is the source of truth for the chain; this is the fallback
  // for rows written before compaction started recording it, which would
  // otherwise end the history early. Returning null ends the chain.
  resolvePreviousSegment?: (sessionId: string) => string | null,
) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // statusEvent surfaces lifecycle events from the agent (e.g. capability
  // reloads) delivered as chunk kind "status".
  const [statusEvent, setStatusEvent] = useState<{ event: string; state?: string; at: number } | null>(null)
  // taskProgress tracks delegated subagents that are still running (same chunk
  // kind, event "task_progress"), so a slow delegation shows a live line
  // instead of a silent wait. An entry disappears when its task reports
  // done/error, and the whole list is cleared when the turn ends.
  const [taskProgress, setTaskProgress] = useState<TaskProgress[]>([])
  // busy is true while a turn is in flight: set when the user sends a message,
  // cleared when the gateway completes the turn (success or failure). Derived
  // from the messages it would flicker between stream chunks, so the turn
  // lifecycle is tracked explicitly.
  const [busy, setBusy] = useState(false)
  // serverRunning mirrors the server-side turn flag, which survives client
  // disconnects: it keeps the running indicator honest after a reconnect.
  const [serverRunning, setServerRunning] = useState(false)
  // unloadedSegments counts stored segments older than the ones in memory; the
  // transcript turns it into the spacer above the oldest loaded message. It
  // reaches 0 once the whole chain has been walked.
  const [unloadedSegments, setUnloadedSegments] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // todos is the current task list (from the todowrite tool) used by the
  // progress button; pendingQuestion is a blocking question awaiting an answer.
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  // serverMode is the build/plan mode the conversation itself last ran in, read
  // from the segment's `_session_agent` meta (see lib/agentMode). The pane keeps
  // the user's own pick of the moment next to it; a fresh conversation has no
  // segment to read, so this stays null and the agent's default shows.
  const [serverMode, setServerMode] = useState<AgentMode | null>(null)
  // prefixCountRef is how many leading transcript entries belong to older
  // segments: loaded, immutable, and never replaced by a newer segment read.
  const prefixCountRef = useRef(0)
  // Chain-walk state: the next older segment to read, how many hops have been
  // made, whether a walk is running, and which segments are in memory.
  const chainPrevRef = useRef<string | null>(null)
  const chainHopsRef = useRef(0)
  const walkingRef = useRef(false)
  const loadedSegmentIdsRef = useRef<Set<string>>(new Set())
  // The segment the socket runs on and the validator of its last read, so a
  // re-read (reconnect) can be answered 304 instead of transferring the row.
  const headSegmentRef = useRef<string | null>(null)
  const headEtagRef = useRef<string | undefined>(undefined)
  const headLoadedRef = useRef(false)
  // When the last streamed chunk arrived: the running-state reconciliation only
  // believes "not running" once the stream has been quiet for a while.
  const lastChunkAtRef = useRef(0)
  // A streaming compaction divider is evidence that a compaction is still
  // running — its inner calls emit nothing, so there may be no chunk for
  // minutes. compactionDeadlineRef bounds how long that evidence counts, so a
  // crashed agent still converges (see turnState.ts).
  const compactionStreamingRef = useRef(false)
  const compactionDeadlineRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const chatIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const pendingSendsRef = useRef<{ content: string; mode: AgentMode; media: ChatMediaItem[] }[]>([])
  const unloadedSegmentsRef = useRef(0)
  const mountedRef = useRef(true)
  // The latest access token, read inside connect() so the socket effect does
  // not tear down and reconnect every time the token is refreshed.
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])
  // Current agent id, read inside the memoized handleEvent so persisted context
  // usage is written under the active agent without re-binding the socket.
  const agentIdRef = useRef(agentId)
  useEffect(() => {
    agentIdRef.current = agentId
  }, [agentId])
  // Callbacks are held in refs so handleEvent and the socket effect always
  // invoke the latest version without churning the connection. onSessionInvalid
  // in particular is re-created by the caller on every session-list write;
  // keeping it out of the socket effect's dependencies is what stops a list
  // refresh from reconnecting the chat (and re-reading its history).
  const onTurnCompleteRef = useRef(onTurnComplete)
  const onSessionChangedRef = useRef(onSessionChanged)
  const onSessionInvalidRef = useRef(onSessionInvalid)
  const loadSegmentRef = useRef(loadSegment)
  const loadSessionMetaRef = useRef(loadSessionMeta)
  const resolvePreviousSegmentRef = useRef(resolvePreviousSegment)
  useEffect(() => {
    loadSegmentRef.current = loadSegment
  })
  useEffect(() => {
    loadSessionMetaRef.current = loadSessionMeta
  })
  useEffect(() => {
    resolvePreviousSegmentRef.current = resolvePreviousSegment
  })
  useEffect(() => {
    onTurnCompleteRef.current = onTurnComplete
  })
  useEffect(() => {
    onSessionChangedRef.current = onSessionChanged
  })
  useEffect(() => {
    onSessionInvalidRef.current = onSessionInvalid
  })
  useEffect(() => {
    unloadedSegmentsRef.current = unloadedSegments
  }, [unloadedSegments])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Conversation identity = (agent, session). When it changes we reset the
  // conversation-scoped STATE during render (the React "adjust state when a
  // prop changes" pattern) so the caller immediately sees an empty conversation
  // and no stale session id — otherwise A's streaming bubbles, busy flag and
  // session id leak into B's conversation. Mutable refs are reset in the socket
  // effect (refs must not be touched during render).
  const convKey = `${agentId ?? ''}\u0000${sessionId ?? ''}`
  const [renderedConvKey, setRenderedConvKey] = useState<string | null>(null)
  if (renderedConvKey !== convKey) {
    setRenderedConvKey(convKey)
    setMessages([])
    setConversationId(null)
    setResolvedSessionId(null)
    setBusy(false)
    setServerRunning(false)
    setStatusEvent(null)
    setTaskProgress([])
    setError(null)
    setUnloadedSegments(sessionId ? 1 : 0)
    setLoadingOlder(false)
    setTodos([])
    setPendingQuestion(null)
    setPendingApproval(null)
    setContextUsage(readStoredContextUsage(agentId))
    setServerMode(null)
  }
  // Tracks the conversation whose refs are currently initialised (reset in the
  // socket effect, never during render), and the latest conv key for the
  // component-level segment helpers.
  const refConvKeyRef = useRef<string | null>(null)
  // convKeyRef mirrors the conversation identity for the segment helpers, which
  // are created once and must be able to tell that the identity changed while a
  // read was in flight. Declared before the socket effect so the value is
  // already current when that effect runs.
  const convKeyRef = useRef(convKey)
  useEffect(() => {
    convKeyRef.current = convKey
  }, [convKey])

  // readSegment reads one stored segment, through the cross-pane gate.
  const readSegment = useCallback((id: string, etag?: string): Promise<LoadedSegment> => {
    const load = loadSegmentRef.current
    if (!load) {
      return Promise.reject(new Error('no segment loader'))
    }
    return withSegmentSlot(() => load(id, etag))
  }, [])

  // advanceChain records what comes before a segment: what the row says, or — when
  // it says nothing — what the caller can infer from the conversation's rows.
  const advanceChain = useCallback((segment: LoadedSegment) => {
    chainPrevRef.current =
      segment.previousSessionId ?? resolvePreviousSegmentRef.current?.(segment.sessionId) ?? null
  }, [])

  // walkChain reads the chain of older segments one at a time and prepends each
  // to the transcript, so scrolling up is immediate. Bounded by
  // MAX_HISTORY_SEGMENT_HOPS and cancelled when the conversation identity
  // changes.
  const walkChain = useCallback(() => {
    if (walkingRef.current) {
      return
    }
    walkingRef.current = true
    setLoadingOlder(true)
    const key = convKeyRef.current
    const step = () => {
      const stale = !mountedRef.current || convKeyRef.current !== key
      const next = nextSegmentToRead({
        prev: chainPrevRef.current,
        hops: chainHopsRef.current,
        loaded: loadedSegmentIdsRef.current,
        maxHops: MAX_HISTORY_SEGMENT_HOPS,
      })
      if (stale || !next) {
        walkingRef.current = false
        if (!stale) {
          setLoadingOlder(false)
          setUnloadedSegments(0)
        }
        return
      }
      readSegment(next)
        .then((segment) => {
          if (!mountedRef.current || convKeyRef.current !== key) {
            return
          }
          loadedSegmentIdsRef.current.add(segment.sessionId)
          advanceChain(segment)
          chainHopsRef.current += 1
          setMessages((current) => prependSegment(current, segment.messages))
          prefixCountRef.current += segment.messages.length
          setUnloadedSegments(chainPrevRef.current ? Math.max(1, unloadedSegmentsRef.current) : 0)
          step()
        })
        .catch(() => {
          walkingRef.current = false
          setLoadingOlder(false)
        })
    }
    step()
  }, [advanceChain, readSegment])

  // applyHead merges the segment the socket runs on into the transcript and
  // starts the background walk of everything older.
  const applyHead = useCallback(
    (segment: LoadedSegment) => {
      setServerRunning(segment.turnRunning)
      setTodos(segment.todos ?? [])
      setPendingQuestion(segment.pendingQuestion ?? null)
      setPendingApproval(segment.pendingApproval ?? null)
      // The head segment is the conversation's own record of what mode it is in.
      setServerMode(segment.mode ?? null)
      // Read before the update runs: the updater may execute after the ref has
      // been set below, and the merge has to know whether a stored base existed
      // *before* this read.
      const headWasLoaded = headLoadedRef.current
      setMessages((current) =>
        ensureCompactionDivider(
          mergeSegment(current, segment.messages, prefixCountRef.current, headWasLoaded),
          // Only while the turn is still live: a compaction marker left behind by
          // a crashed agent must not render a divider that never finishes.
          Boolean(segment.compacting && segment.turnRunning),
          nextId,
        ),
      )
      recordDiag('segment.apply', {
        sessionID: segment.sessionId,
        messages: segment.messages.length,
        headWasLoaded,
      })
      loadedSegmentIdsRef.current.add(segment.sessionId)
      headSegmentRef.current = segment.sessionId
      headEtagRef.current = segment.etag
      headLoadedRef.current = true
      advanceChain(segment)
      setUnloadedSegments(chainPrevRef.current ? Math.max(1, unloadedSegmentsRef.current) : 0)
      walkChain()
    },
    [advanceChain, walkChain],
  )

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'ready':
        chatIdRef.current = event.chat_id
        sessionIdRef.current = event.session_id ?? null
        setConversationId(event.chat_id)
        setResolvedSessionId(event.session_id ?? null)
        recordDiag('ws.ready', { chatID: event.chat_id, sessionID: event.session_id ?? '(none)' })
        break
      case 'chunk':
        lastChunkAtRef.current = Date.now()
        if ((event.kind ?? 'content') === 'status') {
          try {
            const payload = JSON.parse(event.content) as {
              event?: string
              state?: string
              used?: number
              limit?: number
              pct?: number
              budget?: number
              threshold?: number
              id?: string
              description?: string
              detail?: string
            }
            if (payload.event === 'usage') {
              const usage = {
                used: payload.used ?? 0,
                limit: payload.limit ?? 0,
                pct: payload.pct ?? 0,
                budget: payload.budget,
                threshold: payload.threshold,
              }
              setContextUsage(usage)
              writeStoredContextUsage(agentIdRef.current, usage)
              return
            }
            if (payload.event === 'compaction') {
              // /compact announces "started" before the summary streams; open a
              // pulsing divider that the "summary" chunks then fill in.
              if (payload.state === 'started') {
                setMessages((current) => {
                  if (current.some((m) => m.role === 'assistant' && m.kind === 'compaction' && m.streaming)) {
                    return current
                  }
                  return [
                    ...current,
                    { id: nextId(), role: 'assistant', kind: 'compaction', summary: '', streaming: true },
                  ]
                })
              }
              return
            }
            if (payload.event === 'task_progress') {
              const id = payload.id ?? ''
              const state = payload.state ?? ''
              setTaskProgress((current) => {
                const rest = current.filter((task) => task.id !== id)
                if (state === 'done' || state === 'error') return rest
                return [...rest, { id, description: payload.description ?? '', state, detail: payload.detail ?? '' }]
              })
              return
            }
            setStatusEvent({ event: payload.event ?? 'status', state: payload.state, at: Date.now() })
          } catch {
            // malformed status chunk — ignore
          }
          return
        }
        if (event.kind === 'todo') {
          try {
            setTodos(JSON.parse(event.content) as TodoItem[])
          } catch {
            // malformed todo chunk — ignore
          }
          return
        }
        if (event.kind === 'question') {
          try {
            setPendingQuestion(JSON.parse(event.content) as PendingQuestion)
          } catch {
            // malformed question chunk — ignore
          }
          return
        }
        if (event.kind === 'approval') {
          try {
            setPendingApproval(JSON.parse(event.content) as PendingApproval)
          } catch {
            // malformed approval chunk — ignore
          }
          return
        }
        // Any streamed chunk means a turn is actively running. Assembly lives in
        // liveMessages.ts: blocks are keyed by (message_id, kind) so a reasoning
        // tail that arrives after the answer still lands in its own iteration's
        // thought block instead of opening a second one.
        setServerRunning(true)
        setMessages((current) =>
          appendLiveChunk(
            current,
            { kind: event.kind ?? 'content', content: event.content, messageId: event.message_id },
            nextId,
            Date.now(),
          ),
        )
        break
      case 'complete': {
        setBusy(false)
        setServerRunning(false)
        setTaskProgress([])
        setMessages((current) => {
          // Finalize any streaming blocks and drop assistant content bubbles
          // that ended up empty (empty/aborted completion), so no blank bubble
          // is left behind.
          let copy = finalizeBlocks(current, Date.now())
          currentAssistantIdRef.current = null
          // A compaction that ran during this turn reports its summary here, and
          // this is the authoritative copy: the streamed summary chunks can be
          // lost (a dropped socket) or never sent (a provider without deltas, a
          // /compact with nothing new to summarize), and the persisted divider
          // only reaches the pane through a history read. Filling it now is what
          // makes the result visible without a reload.
          if (event.summary) {
            copy = patchCompactionSummary(copy, event.summary, nextId)
          }
          if (event.error) {
            // A stopped turn is not a failure: keep any partial content and add
            // a neutral "stopped" note instead of a red error bubble.
            if (event.error === 'stopped') {
              copy.push({ id: nextId(), role: 'assistant', kind: 'stopped', streaming: false })
              return copy
            }
            // A failed turn: render an inline error bubble so the failure is
            // visible in the conversation flow (not just the connection pill).
            copy.push({
              id: nextId(),
              role: 'assistant',
              kind: 'error',
              category: event.error,
              detail: event.error_detail ?? '',
              streaming: false,
            })
            return copy
          }
          const finalContent = event.content ?? ''
          if (finalContent.trim() === '') {
            // No answer text — typically a provider abort/empty completion.
            log.warn('turn completed with no content')
            return copy
          }
          // The complete event carries the authoritative answer; patch the answer
          // block of the iteration that just finished (the last one).
          return patchFinalAnswer(copy, finalContent, nextId)
        })
        // A session change (e.g. a per-agent split archived this one and moved
        // to a new versioned session) is signalled by a different session_id on
        // the completion. Adopt it so subsequent messages resume the new session.
        if (event.session_id && event.session_id !== sessionIdRef.current) {
          sessionIdRef.current = event.session_id
          setResolvedSessionId(event.session_id)
          onSessionChangedRef.current?.(event.session_id)
        }
        onTurnCompleteRef.current?.()
        // Reconcile the small mutable state (todos, a pending question/approval,
        // whether a turn is still running) from the metadata read. The streamed
        // messages stay as they are: re-reading would replace them with a row
        // that lags the stream.
        const sid = sessionIdRef.current
        if (sid && loadSessionMetaRef.current) {
          loadSessionMetaRef.current(sid)
            .then((meta) => {
              setServerRunning(meta.turnRunning)
              setTodos(meta.todos ?? [])
              setPendingQuestion(meta.pendingQuestion)
              setPendingApproval(meta.pendingApproval)
              // A fresh conversation is named and recorded by its first turn, so
              // this is where a brand-new one learns the mode it just ran in.
              setServerMode(conversationModeOf(meta.sessionAgent))
            })
            .catch(() => {})
        }
        break
      }
      case 'error':
        setError(event.error)
        setBusy(false)
        setServerRunning(false)
        break
    }
  }, [])

  // A compaction block is only ever the last block while it streams (a later
  // content chunk finalizes it), so its own evidence is one lookup, and it is
  // refreshed by every summary chunk. Arm the bounded window it is believed for;
  // the reconciliation below reads it.
  useEffect(() => {
    const last = messages[messages.length - 1]
    const streamingCompaction =
      !!last && last.role === 'assistant' && last.kind === 'compaction' && last.streaming
    compactionStreamingRef.current = streamingCompaction
    if (streamingCompaction) {
      compactionDeadlineRef.current = Date.now() + COMPACTION_SILENCE_BUDGET_MS
    }
  }, [messages])

  // Turn-state self-heal. A missed completion (dropped socket, a second pane
  // the gateway routed events away from, an agent that died mid-turn) used to
  // leave the running indicator on forever because nothing re-read the flag.
  // While a turn looks in flight, re-read the metadata until it agrees.
  useEffect(() => {
    if (!busy && !serverRunning) {
      return
    }
    const timer = window.setInterval(() => {
      const sid = sessionIdRef.current
      if (!sid || !loadSessionMetaRef.current) {
        return
      }
      // Only a connected client can trust this: while the socket is down the
      // queued message has not reached the agent yet, so "not running" would be
      // reporting the wrong thing.
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return
      }
      loadSessionMetaRef.current(sid)
        .then((meta) => {
          const now = Date.now()
          // The server flag settles it; the stream's own evidence covers the
          // stretches where a command emits nothing (a compaction's memory flush
          // and summary), and a freshly arrived chunk covers the rest.
          if (
            turnLooksAlive({
              serverRunning: meta.turnRunning,
              streamingCompaction: compactionStreamingRef.current,
              compactionDeadline: compactionDeadlineRef.current,
              sinceLastChunkMs: now - lastChunkAtRef.current,
              quietMs: RUNNING_QUIET_MS,
              now,
            })
          ) {
            return
          }
          log.info('turn state reconciled: the server reports no running turn')
          setServerRunning(false)
          setBusy(false)
        })
        .catch(() => {
          // Session gone (archived/deleted): nothing can still be running.
          setServerRunning(false)
          setBusy(false)
        })
    }, RUNNING_RECONCILE_MS)
    return () => window.clearInterval(timer)
  }, [busy, serverRunning])

  useEffect(() => {
    if (!agentId || !token) {
      return
    }

    // Reset conversation-scoped refs when the (agent, session) identity changes
    // (state was already reset during render). Runs before connect() and after
    // the previous socket's cleanup, so the old binding is fully dropped.
    if (refConvKeyRef.current !== convKey) {
      refConvKeyRef.current = convKey
      chatIdRef.current = null
      sessionIdRef.current = null
      currentAssistantIdRef.current = null
      pendingSendsRef.current = []
      prefixCountRef.current = 0
      chainPrevRef.current = null
      chainHopsRef.current = 0
      walkingRef.current = false
      loadedSegmentIdsRef.current = new Set()
      headSegmentRef.current = null
      headEtagRef.current = undefined
      headLoadedRef.current = false
      lastChunkAtRef.current = 0
      compactionStreamingRef.current = false
      compactionDeadlineRef.current = 0
    }

    let cancelled = false
    let closedByEffect = false
    let opened = false
    const backoff = new ReconnectBackoff({ name: 'chat', baseMs: INITIAL_RECONNECT_DELAY, maxMs: MAX_RECONNECT_DELAY })
    let ws: WebSocket | null = null
    let reconnectTimer: number | null = null

    const flushPending = () => {
      if (cancelled || !ws || ws.readyState !== WebSocket.OPEN) {
        return
      }
      const pending = pendingSendsRef.current
      pendingSendsRef.current = []
      if (pending.length > 0) {
        log.debug(`flushing ${pending.length} queued message(s)`)
      }
      for (const { content, mode, media } of pending) {
        ws.send(JSON.stringify({ type: 'message', content, media, metadata: { agent_mode: mode } }))
      }
    }

    const connect = () => {
      if (cancelled || closedByEffect) {
        return
      }
      // Resume the session this pane is actually running, not the one it mounted
      // with: a fresh conversation keeps `sessionId` null for its whole life (the
      // tab only records the conversation key), so a reconnect that trusted the
      // prop reconnected *without* a session and the gateway minted a brand-new
      // conversation — the old transcript was then cleared by the open handler.
      // Use the latest token so a post-reconnect token refresh doesn't tear
      // down and re-create the socket (which would drop the in-flight stream).
      const resumeID = resumeIDFor(sessionIdRef.current, sessionId)
      ws = new WebSocket(agentWsUrl(agentId, tokenRef.current, resumeID))
      wsRef.current = ws
      recordDiag('ws.create', { agentID: agentId, sessionID: resumeID ?? '(none)' })
      log.debug('connecting')

      ws.onopen = () => {
        opened = true
        backoff.reset()
        setConnected(true)
        setReconnecting(false)
        setError(null)
        log.info('open')

        if (resumeID && loadSegmentRef.current) {
          // Read the segment the socket runs on. On a reconnect this fills in
          // anything streamed while the client was away; the stored ETag answers
          // 304 when nothing changed, leaving the transcript untouched.
          const etag = headSegmentRef.current === resumeID ? headEtagRef.current : undefined
          readSegment(resumeID, etag)
            .then((segment) => {
              if (cancelled) {
                return
              }
              // 304: the stored row is unchanged, so the transcript (and the
              // chain state) already in memory is still right.
              if (!segment.notModified) {
                applyHead(segment)
              }
              flushPending()
            })
            .catch((err: Error) => {
              if (cancelled) {
                return
              }
              recordDiag('segment.readFailed', { sessionID: resumeID, error: err.message })
              // A session the server no longer knows: the caller re-points the
              // tab (the conversation usually moved on to a new segment).
              if (handshakeVerdict(err.message) === 'gone') {
                onSessionInvalidRef.current?.()
                return
              }
              setUnloadedSegments(0)
              flushPending()
            })
        } else {
          setMessages([])
          setUnloadedSegments(0)
          flushPending()
        }
      }

      ws.onmessage = (event) => {
        let data: AgentEvent
        try {
          data = JSON.parse(event.data as string) as AgentEvent
        } catch {
          return
        }
        // Only accept turn frames bound to the currently-connected conversation.
        // Late chunk/complete frames from a prior agent or session (buffered in
        // a socket around a switch) must not be appended to the new transcript.
        if (data.type === 'chunk' || data.type === 'complete') {
          const chatId = (data as { chat_id?: string }).chat_id
          if (!chatIdRef.current || (chatId && chatId !== chatIdRef.current)) {
            return
          }
        }
        handleEvent(data)
      }

      const scheduleReconnect = () => {
        if (cancelled || closedByEffect) {
          return
        }
        setReconnecting(true)
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null
          connect()
        }, backoff.nextDelay())
      }

      ws.onclose = (event) => {
        setConnected(false)
        // A dropped socket means no further chunks/completions will arrive for
        // the in-flight turn; the indicator must not stick. The reconciliation
        // read (and the segment re-read on reconnect) keeps it honest.
        setBusy(false)
        log.info(`closed (code=${event.code}${event.reason ? `, after ${event.reason}` : ''})`)
        recordDiag('ws.close', { code: event.code, opened, sessionID: sessionId ?? '(none)' })
        if (cancelled || closedByEffect) {
          return
        }
        // A handshake that never opened says nothing about the session: the
        // network may be down, the proxy may answer 502 while the gateway
        // restarts, a deploy may be in flight. Only the store can tell an
        // unknown session from an unreachable one — asking it first is what
        // stops a brief outage from wiping the tab and minting a new
        // conversation.
        if (!opened && sessionId) {
          const check = loadSessionMetaRef.current
          if (!check) {
            setError(i18n.t('errors.sessionUnreachable'))
            onSessionInvalidRef.current?.()
            return
          }
          check(sessionId)
            .then(() => {
              recordDiag('ws.handshake', { sessionID: sessionId, verdict: 'reachable' })
              scheduleReconnect()
            })
            .catch((err: Error) => {
              if (cancelled || closedByEffect) {
                return
              }
              if (handshakeVerdict(err?.message) === 'gone') {
                recordDiag('ws.handshake', { sessionID: sessionId, verdict: 'gone' })
                setError(i18n.t('errors.sessionUnreachable'))
                onSessionInvalidRef.current?.()
                return
              }
              recordDiag('ws.handshake', {
                sessionID: sessionId,
                verdict: 'unreachable',
                error: err?.message ?? 'unknown',
              })
              scheduleReconnect()
            })
          return
        }
        scheduleReconnect()
      }

      ws.onerror = () => {
        setConnected(false)
        log.warn('socket error')
        if (!opened) {
          setError(i18n.t('errors.websocket'))
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      closedByEffect = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }
      // A local copy: `ws` is reassigned by connect(), so TypeScript cannot keep
      // it narrowed inside the closure below.
      const socket = ws
      if (socket) {
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        // Closing during the handshake is the one case the browser reports as
        // "closed before the connection is established"; let it open, then close.
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => socket.close()
        } else {
          socket.close()
        }
        wsRef.current = null
      }
    }
  // Note: `token` is intentionally NOT a dependency — the socket reads the
  // latest token from tokenRef so a token refresh doesn't churn the connection.
  // `onSessionInvalid` is held in a ref for the same reason: the caller
  // recreates it on every session-list write, and depending on it made the chat
  // reconnect (and re-read its history) on every list refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayUrl, agentId, sessionId, handleEvent, readSegment, applyHead])

  const send = useCallback((content: string, mode: AgentMode = 'build', media: ChatMediaItem[] = []) => {
    const trimmed = content.trim()
    if (!trimmed && media.length === 0) {
      return
    }
    setBusy(true)
    // The bubble appears immediately in both cases: a message typed while the
    // socket is down is queued for the reconnect, but the user must still see
    // that it was accepted.
    setMessages((current) => [
      ...current,
      {
        id: nextId(),
        role: 'user',
        content: trimmed || mediaDisplay(media),
        streaming: false,
        mode,
        pending: true,
      },
    ])
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', content: trimmed, media, metadata: { agent_mode: mode } }))
      return
    }
    // Bound the offline queue so sustained disconnects cannot grow memory.
    if (pendingSendsRef.current.length >= MAX_PENDING_SENDS) {
      pendingSendsRef.current.shift()
      log.warn(`pending queue full (${MAX_PENDING_SENDS}) — dropping oldest message`)
    }
    pendingSendsRef.current.push({ content: trimmed, mode, media })
  }, [])

  const clear = useCallback(() => {
    setMessages([])
    setBusy(false)
  }, [])

  // sendCommand sends a slash-command (e.g. /compact) without appending a user
  // bubble; the agent replies with a completion.
  const sendCommand = useCallback((command: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return
    }
    setBusy(true)
    wsRef.current.send(JSON.stringify({ type: 'message', content: command }))
  }, [])

  // stop aborts the agent's in-flight turn for this session. No bubble is
  // appended; the turn completes with a "stopped" marker.
  const stop = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return
    }
    wsRef.current.send(JSON.stringify({ type: 'message', content: '/stop' }))
  }, [])

  // answerQuestion sends the user's answer for the pending blocking question.
  // The answer carries metadata.question_id so the agent routes it to the
  // waiting turn instead of starting a new one.
  const answerQuestion = useCallback(
    (answers: string[]) => {
      const q = pendingQuestion
      if (!q || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return
      }
      wsRef.current.send(
        JSON.stringify({ type: 'message', content: answers.join('\n'), metadata: { question_id: q.id, answers } }),
      )
      setPendingQuestion(null)
      setBusy(true)
    },
    [pendingQuestion],
  )

  // answerApproval sends the user's decision for a pending permission prompt.
  // The decision rides metadata.approval_id/decision so the agent routes it to
  // the waiting approval instead of starting a new turn.
  const answerApproval = useCallback(
    (decision: PermissionDecision) => {
      const a = pendingApproval
      if (!a || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return
      }
      wsRef.current.send(
        JSON.stringify({ type: 'message', content: decision, metadata: { approval_id: a.id, decision } }),
      )
      setPendingApproval(null)
      setBusy(true)
    },
    [pendingApproval],
  )

  // loadOlder is the scroll-up affordance. The background walk normally has the
  // older segments in memory already, so this is usually a no-op; it also lets
  // the reader retry a read that failed (the head read included, when nothing
  // loaded at all).
  const loadOlder = useCallback(() => {
    if (loadingOlder || unloadedSegments === 0) {
      return
    }
    const key = convKeyRef.current
    const next = nextSegmentToRead({
      prev: chainPrevRef.current,
      hops: chainHopsRef.current,
      loaded: loadedSegmentIdsRef.current,
      maxHops: MAX_HISTORY_SEGMENT_HOPS,
    })
    if (!next) {
      // Nothing older is queued: either the walk finished (drop the spacer) or
      // the initial read failed and the reader is asking again.
      if (!headLoadedRef.current && sessionId && loadSegmentRef.current) {
        setLoadingOlder(true)
        readSegment(sessionId)
          .then((segment) => {
            if (mountedRef.current && convKeyRef.current === key && !segment.notModified) {
              applyHead(segment)
            }
          })
          .catch(() => {})
          .finally(() => {
            setLoadingOlder(false)
          })
        return
      }
      setUnloadedSegments(0)
      return
    }
    setLoadingOlder(true)
    readSegment(next)
      .then((segment) => {
        if (!mountedRef.current || convKeyRef.current !== key) {
          return
        }
        loadedSegmentIdsRef.current.add(segment.sessionId)
        advanceChain(segment)
        chainHopsRef.current += 1
        setMessages((current) => prependSegment(current, segment.messages))
        prefixCountRef.current += segment.messages.length
        setUnloadedSegments(chainPrevRef.current ? Math.max(1, unloadedSegmentsRef.current) : 0)
      })
      .catch(() => {
        // Keep the affordance so the reader can retry.
      })
      .finally(() => {
        setLoadingOlder(false)
      })
  }, [advanceChain, applyHead, loadingOlder, readSegment, sessionId, unloadedSegments])

  return {
    messages,
    conversationId,
    sessionId: resolvedSessionId,
    connected,
    reconnecting,
    error,
    busy,
    serverRunning,
    statusEvent,
    taskProgress,
    hasMoreHistory: unloadedSegments > 0,
    unloadedSegments,
    loadingOlder,
    loadOlder,
    todos,
    pendingQuestion,
    pendingApproval,
    contextUsage,
    // What the conversation itself last ran in; the pane combines it with its own
    // pick and the agent's default (lib/agentMode).
    conversationMode: serverMode,
    send,
    sendCommand,
    stop,
    answerQuestion,
    answerApproval,
    clear,
  }
}
