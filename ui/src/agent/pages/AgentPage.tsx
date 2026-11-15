import { lazy, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { AlertTriangle, ArrowDown, Bot, Brain, Brush, CheckCircle2, ChevronDown, Circle, Command, Cpu, FolderOpen, FolderPlus, FolderTree, HelpCircle, ImagePlus, Lightbulb, Loader2, MessageSquare, MessageSquarePlus, Mic, Minimize2, MoreHorizontal, Paperclip, Plus, RefreshCw, Send, Settings, Sparkles, Square, SquareTerminal, Trash2, Wrench, X, XCircle, Zap } from 'lucide-react'
import { Navigate, useNavigate, useSearchParams } from '../router'
import { toast } from '../lib/toast'
import { portalApi } from '../portal/api'
import { portalUI } from '../portal/ui'
import { useTranslation } from 'react-i18next'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { Spinner } from '../components/ui/spinner'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { AgentFormDialog } from '../components/agent-form-dialog'
import { AgentGroupDialog } from '../components/agent/AgentGroupDialog'
import { AgentGroupSection } from '../components/agent/AgentGroupSection'
import { AttentionDots } from '../components/agent/AttentionDots'
import { FilePanel } from '../components/agent/FilePanel'
import { TaskList } from '../components/agent/TaskListPanel'
import { UserConfigPage } from './UserConfigPage'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { Panel, PanelGroup, PanelResizeHandle } from '../components/ui/resizable'
import { Workbench } from '../workbench/Workbench'
import { GitBrowserPanel } from '../../components/git/GitBrowserPanel'
import { getHost, setHost } from '../../host'
import { usePlugins } from '../portal/registry'
import { useTheme } from '../lib/theme'
import { recordDiag } from '../lib/debug'
import { paneLayerAriaHidden, paneLayerClass } from '../lib/paneVisibility'
import type { WorkbenchPlugin } from '../workbench/types'
import type { PanelOps, AgentWorkbench, ChatWorkbench } from '../workbench/context'
import { AgentWorkbenchProvider, ChatWorkbenchProvider, useWorkbench, useChatWorkbench } from '../workbench/context'
import {
  ConversationsProvider,
  useActiveConversation,
  useConversations,
  useConversationsState,
  type ConversationsContextValue,
} from '../conversations/context'
import {
  conversationKeyOf,
  createConversationsStore,
  EMPTY_SUMMARY,
  MAX_TABS,
  unusedFreshTabId,
  type ConversationTab,
  type ConversationsState,
} from '../conversations/store'
import { TerminalPanel, TerminalHeaderActions, TerminalStatusBar } from '../components/agent/TerminalPanel'
import { CapabilityList } from '../components/agent/CapabilitiesQuickMenu'
import { useAgentCapabilities } from '../hooks/useAgentCapabilities'
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea'
import { useIsLaidOut } from '../hooks/useIsLaidOut'
import { useComposerFit } from '../hooks/composerFit'
import { trailingAction } from '../composer/trailingAction'
import { elementOnScreen, matchesShortcut, resolveShortcut, shortcutLabel, isMacPlatform } from '../lib/shortcut'
import { getShortcutOverride, subscribeShortcutOverride } from '../lib/voiceShortcut'
import { MicSettingsPanel } from '../components/composer/MicSettingsPanel'
import { THINKING_LEVELS, type ResolvedThinking, type ThinkingLevel } from '../lib/thinking'
import { useThinkingLevel, type ThinkingChoice } from '../hooks/useThinkingLevel'
import { joinDraft } from '../voice/events'
import {
  useRealtimeVoice,
  voiceSupported,
  type VoiceErrorCode,
  type VoicePhase,
  type VoiceResult,
} from '../voice/useRealtimeVoice'
import { voiceStageUi } from '../voice/stageUi'
import { useVoiceConfig } from '../voice/useVoiceConfig'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { GATEWAY_URL, listAgents, type Agent } from '../lib/agentApi'
import { bucketAgents } from '../lib/agentGrouping'
import { groupPlacement, moveGroupOrder } from '../lib/agentDrag'
import { usePointerDrag, type PointerDrag } from '../hooks/usePointerDrag'
import {
  createAgentGroup,
  deleteAgentGroup,
  arrangeAgents,
  listAgentGroups,
  renameAgentGroup,
  reorderAgentGroups,
  type AgentGroup,
} from '../lib/agentGroups'
import { getSession } from '../lib/auth'
import {
  archiveAgentSession,
  deleteAgent,
  listAgentAttention,
  listAgentSessions,
  provisionAgent,
  readAgentSession,
  restartAgent as restartAgentApi,
  uploadFile,
  type SessionSummary,
} from '../lib/api'
import { compactThresholdPct } from '../lib/contextRing'
import { conversationModeOf, defaultModeOf, resolveAgentMode } from '../lib/agentMode'
import { getAgentMode, setAgentMode } from '../lib/capabilities'
import { listMyModels } from '../lib/models'
import type { TypeModelBinding } from '../lib/agentTypes'
import { FOLLOW_DEFAULT_VALUE, modelSelectLabel, modelSelectOptions } from '../lib/modelOptions'
import { useAgent, type AgentMessage, type AgentMode, type ChatMediaItem, type LoadedSegment, type PendingApproval, type PendingQuestion, type PermissionDecision, type TaskProgress, type TodoItem } from '../hooks/useAgent'
import { cn } from '../lib/utils'
import {
  BOTTOM_POSITION,
  TRANSCRIPT_BOTTOM_THRESHOLD_PX,
  TRANSCRIPT_JUMP_DISTANCE_PX,
  anchorFromRects,
  restoreTarget,
  type AnchorPosition,
  type RowRect,
  type TranscriptPosition,
} from '../lib/transcriptPosition'
import {
  BASE_FIRST_ITEM_INDEX,
  indexOfKey,
  keyAtIndex,
  nextFirstItemIndex,
  sameKeys,
} from '../lib/transcriptIndex'
import {
  entryFor,
  groupSessions,
  resolveResumeSession,
  invalidSessionAction,
  isResumableSession,
  previousSegmentFallback,
  isFresh,
  mayApply,
  mergeSessionRows,
  persistableLists,
  restoredFromSnapshot,
  topConversationExcluding,
  withEntry,
  withoutAgent,
  type SessionListEntry,
  type SessionLists,
} from '../conversations/sessionLists'
import { readListCache, writeListCache } from '../lib/listCache'
import {
  applyLiveAttention,
  indexAttention,
  sessionAttention,
  attentionKey,
  nextReadAt,
  type ConversationAttention,
  type ReadAt,
} from '../conversations/attention'
import {
  clearState,
  readRawState,
  readState,
  stateKey,
  writeRawState,
  writeState,
  writeStateMerged,
} from '../lib/clientState'
import { messagesFromProvider, parseProviderMessages } from '../lib/historyMessages'
import { composeAnswer } from '../lib/questionAnswer'
import { questionPairs } from '../lib/questionRecord'
import { parseSessionMeta, loadSessionMeta } from '../lib/sessionMeta'
import { formatToolArgs } from '../lib/toolDisplay'

// Below this width the workbench switches to its mobile layout; the chat area
// then shows a single conversation and no tab strip.
const NARROW_VIEWPORT = '(max-width: 1023px)'
// A pointer with no hover: hints have to be tapped, not hovered. Asked of the
// device rather than of the width, because a tablet is wide and still touch-only.
const HOVERLESS_MEDIA = '(hover: none)'
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
// Per-agent state lives in the signed-in account's namespace (lib/clientState):
// the last conversation an agent was showing. A conversation's build/plan mode is
// not here — it belongs to the conversation and is read from its own session (see
// lib/agentMode), so switching conversations or devices shows the same mode.
const SESSION_PAGE_SIZE = 25
// The sidebar paging trigger runs on every scroll event; each page costs a
// request plus a snapshot write, so it is throttled.
const SESSION_SCROLL_THROTTLE_MS = 250
// Bucket writes are coalesced before they reach localStorage.
const LIST_PERSIST_DEBOUNCE_MS = 400
// MAX_IMAGE_BYTES bounds a composer image attachment; the agent inlines at most
// this much per image for vision.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

// sanitizeFilename keeps an uploaded file name filesystem-safe for its
// workspace path.
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96)
  return cleaned || 'image'
}

// The markdown renderer is code-split so the agent page loads it lazily and the
// main bundle stays small.
const Markdown = lazy(() => import('../components/ui/markdown'))

function readActiveSession(agentId: string): string | null {
  return readRawState('session', agentId)
}
function writeActiveSession(agentId: string, sessionId: string): void {
  writeRawState('session', agentId, sessionId)
}
function clearActiveSession(agentId: string): void {
  clearState('session', agentId)
}

export function AgentPage() {
  const session = getSession()

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="h-[calc(100vh-2.5rem)] min-h-[28rem]" data-agent-page="">
      <SignedInAgent userId={session.user_id} />
    </div>
  )
}

function SignedInAgent({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const selectedAgentRef = useRef<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  // One conversation list per agent (see conversations/sessionLists.ts): the
  // sidebar renders the selected agent's bucket and a tab reads the bucket of
  // its own agent, so a background refresh cannot leak rows across agents.
  const [sessionLists, setSessionLists] = useState<SessionLists>({})
  const sessionListsRef = useRef<SessionLists>({})
  // Newest request per agent: a response already in flight when a newer one
  // started must not write the bucket. inFlightRef holds the generation of the
  // request currently on the wire, so the sidebar's several callers (mount, tab
  // follow, prefetch) collapse into one request.
  const genByAgentRef = useRef<Record<string, number>>({})
  const inFlightRef = useRef<Record<string, number>>({})
  // A selection request that arrived while a fetch was in flight: its response
  // honours it instead of a second request being sent.
  const pendingSelectRef = useRef<Record<string, boolean>>({})
  const accessToken = getHost().token

  const [formOpen, setFormOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [restartAgentBusy, setRestartAgentBusy] = useState<string | null>(null)
  const [deleteSessionBusy, setDeleteSessionBusy] = useState<string | null>(null)
  // The user's private agent groups. They are loaded next to the agent list and
  // mirrored in a ref so the list-persisting callbacks keep the snapshot whole.
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const groupsRef = useRef<AgentGroup[]>([])
  useEffect(() => {
    groupsRef.current = groups
  }, [groups])
  // The ungrouped bucket has an order too, so it is kept beside the groups.
  const [ungrouped, setUngrouped] = useState<string[]>([])
  const ungroupedRef = useRef<string[]>([])
  useEffect(() => {
    ungroupedRef.current = ungrouped
  }, [ungrouped])
  // What this browser has read, valued by the conversation's server timestamp.
  const [readAt, setReadAt] = useState<ReadAt>(() =>
    readState<ReadAt>('agentRead', undefined, parseReadAt, {}),
  )
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() =>
    readState<string[]>('agentGroups', 'collapsed', parseStringList, []),
  )
  // Preselected group when the form was opened from a group's menu.
  const [formGroupID, setFormGroupID] = useState('')
  const opsRef = useRef<PanelOps | null>(null)
  const [searchParams] = useSearchParams()
  const paramAgent = searchParams.get('agent')

  // Refs mirror the latest values so loadSessionList (a stable callback) can
  // read current state without churning the socket effect.
  const selectedSessionIdRef = useRef<string | null>(null)
  // The agents list for callbacks that must not re-bind on every fetch.
  const agentsRef = useRef<Agent[]>([])
  useEffect(() => {
    agentsRef.current = agents
  }, [agents])
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])
  // One store per page: it owns the open conversations, the active one and
  // their summaries, and restores the previous group after a reload.
  const [convStore] = useState(() => createConversationsStore())
  // The page mirrors the tab group: the sidebar highlight and the reconnect
  // token refresh below both need it.
  const conversationsState = useSyncExternalStore(convStore.subscribe, convStore.getState)
  // What every conversation of the user's agents is doing (running / waiting for
  // the user), fetched in one request. The sidebar cannot work this out alone:
  // it only fetches the selected agent's list, and the list carries no "waiting"
  // marker. Failures are swallowed — a dot is an affordance, not data.
  const [attentionRows, setAttentionRows] = useState<ConversationAttention[]>([])
  const refreshAttention = useCallback(() => {
    listAgentAttention()
      .then((rows) => {
        setAttentionRows(rows)
        // Conversations this browser has never seen start out read: the first
        // snapshot is a baseline, not a page of unread history.
        setReadAt((previous) => {
          const next = nextReadAt(rows, previous)
          if (next === previous) {
            return previous
          }
          writeStateMerged('agentRead', undefined, next, previous, mergeReadAt, parseReadAt)
          return next
        })
      })
      .catch(() => {})
  }, [])
  // The browser's own tabs win for the conversations they hold (their socket
  // streams), so the snapshot is overlaid rather than merged by freshness.
  const attentionWithLive = useMemo(
    () =>
      applyLiveAttention(
        indexAttention(attentionRows, readAt),
        conversationsState.tabs,
        conversationsState.summaries,
      ),
    [attentionRows, readAt, conversationsState],
  )

  // The conversation on screen is being read: record its server timestamp so
  // switching away does not immediately mark it unread.
  useEffect(() => {
    const active = conversationsState.tabs.find((tab) => tab.id === conversationsState.activeId)
    if (!active?.agentId || !active.chatId) {
      return
    }
    const row = attentionRows.find(
      (item) => item.agent_id === active.agentId && item.chat_id === active.chatId,
    )
    if (!row?.updated_at) {
      return
    }
    const key = attentionKey(active.agentId, active.chatId)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadAt((previous) => {
      if (previous[key] === row.updated_at) {
        return previous
      }
      const next = { ...previous, [key]: row.updated_at }
      writeStateMerged('agentRead', undefined, next, previous, mergeReadAt, parseReadAt)
      return next
    })
  }, [attentionRows, conversationsState.activeId, conversationsState.tabs])

  // openConversation is reached from loadSessionList (below) and from every
  // sidebar action, and it keeps the sidebar in step when the tab belongs to
  // the agent the sidebar is showing.
  const openConversationRef = useRef<((agentId: string, sessionId: string | null) => string | null) | null>(null)
  const openConversation = useCallback(
    (agentId: string, sessionId: string | null): string | null => {
      const agent = agentsRef.current.find((item) => item.id === agentId)
      const state = convStore.getState()
      const result = convStore.open({
        agentId,
        sessionId,
        agentName: agent?.display_name || agentId,
        // Clicking a conversation while an untouched new-conversation tab is in
        // front of the user restores it *there*: opening a second tab would leave
        // the empty one behind and make the click look like it did nothing.
        adoptTabId: unusedFreshTabId(state.tabs, state.summaries, state.activeId, agentId),
      })
      if (!result.ok) {
        toast.error(t('agent.tabs.capacity', { max: MAX_TABS }))
        return null
      }
      if (agentId === selectedAgentRef.current) {
        setSelectedSessionId(sessionId)
        if (sessionId) {
          writeActiveSession(agentId, sessionId)
        }
      }
      return result.id
    },
    [convStore, t],
  )
  useEffect(() => {
    openConversationRef.current = openConversation
  }, [openConversation])

  // onSessionResolved remembers the conversation a socket is actually running,
  // so a reload comes back to it. A fresh conversation is not listed in the
  // sidebar until the server has it — the tab is its home until then.
  const onSessionResolved = useCallback((agentId: string, sessionId: string | null) => {
    if (agentId === selectedAgentRef.current && sessionId) {
      writeActiveSession(agentId, sessionId)
    }
  }, [])

  // The snapshot is rewritten on every bucket write (each refresh, each page of
  // paging), so the write is coalesced and stores only the stable fields.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistNow = useCallback(() => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    writeListCache(userId, agentsRef.current, groupsRef.current, ungroupedRef.current, persistableLists(sessionListsRef.current))
  }, [userId])
  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      return
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      writeListCache(userId, agentsRef.current, groupsRef.current, ungroupedRef.current, persistableLists(sessionListsRef.current))
    }, LIST_PERSIST_DEBOUNCE_MS)
  }, [userId])
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const flush = () => persistNow()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      persistNow()
    }
  }, [persistNow])

  // writeBucket commits one agent's list to the ref (read by callbacks) and to the
  // state (read by the renderer); persistence is coalesced by schedulePersist.
  const writeBucket = useCallback(
    (agentId: string, entry: SessionListEntry) => {
      const next = withEntry(sessionListsRef.current, agentId, entry)
      sessionListsRef.current = next
      setSessionLists(next)
      schedulePersist()
    },
    [schedulePersist],
  )

  // selectConversation opens the conversation a list refresh should surface: the
  // remembered one while it still exists, otherwise the newest.
  const selectConversation = useCallback((agentId: string, rows: SessionListEntry['rows']) => {
    const currentActive = selectedSessionIdRef.current
    const activeValid = currentActive !== null && rows.some((session) => session.id === currentActive)
    const pick = activeValid ? currentActive : (rows[0]?.id ?? null)
    if (!pick) {
      clearActiveSession(agentId)
    }
    openConversationRef.current?.(agentId, pick)
  }, [])

  // loadSessionList fetches the newest page for one agent into that agent's own
  // bucket. A bucket younger than SESSION_LIST_FRESH_MS is left alone, so
  // switching between agents issues no request; `force` overrides that after a
  // turn, a delete or a manual retry. A request already on the wire is reused.
  const loadSessionList = useCallback(
    (agentId: string, opts?: { autoSelect?: boolean; force?: boolean }) => {
      const entry = entryFor(sessionListsRef.current, agentId)
      const latestGen = genByAgentRef.current[agentId] ?? 0
      const inFlight = latestGen > 0 && inFlightRef.current[agentId] === latestGen
      if (!opts?.force && (inFlight || isFresh(entry, Date.now()))) {
        if (opts?.autoSelect) {
          if (inFlight) {
            pendingSelectRef.current[agentId] = true
          } else {
            selectConversation(agentId, entry.rows)
          }
        }
        return
      }
      const gen = latestGen + 1
      genByAgentRef.current[agentId] = gen
      inFlightRef.current[agentId] = gen
      // A cold bucket (never fetched) shows the skeleton; a warm one keeps
      // painting its rows while the refresh is in flight.
      writeBucket(agentId, { ...entry, loading: entry.fetchedAt === 0, error: null })
      listAgentSessions(agentId, { limit: SESSION_PAGE_SIZE })
        .then((page) => {
          if (inFlightRef.current[agentId] === gen) {
            inFlightRef.current[agentId] = 0
          }
          if (!mayApply(gen, genByAgentRef.current[agentId] ?? 0)) {
            return
          }
          const rows = groupSessions(mergeSessionRows(entry.rows, page.sessions))
          writeBucket(agentId, {
            rows,
            // Older segments are dropped from `rows` by groupSessions; the
            // transcript still needs them to infer a chain that does not record
            // its predecessor.
            segments: mergeSessionRows(entry.segments, page.sessions),
            total: page.total,
            fetchedAt: Date.now(),
            // Keep whichever cursor is further along: a refresh of the top page
            // must not pull paging back to rows the user already loaded.
            rawOffset: Math.max(entry.rawOffset, page.sessions.length),
            hasMore: entry.hasMore || page.sessions.length === SESSION_PAGE_SIZE,
            loading: false,
            loadingMore: false,
            error: null,
          })
          if (opts?.autoSelect || pendingSelectRef.current[agentId]) {
            pendingSelectRef.current[agentId] = false
            selectConversation(agentId, rows)
          }
        })
        .catch((err) => {
          if (inFlightRef.current[agentId] === gen) {
            inFlightRef.current[agentId] = 0
          }
          pendingSelectRef.current[agentId] = false
          if (!mayApply(gen, genByAgentRef.current[agentId] ?? 0)) {
            return
          }
          writeBucket(agentId, {
            ...entryFor(sessionListsRef.current, agentId),
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          })
        })
    },
    [selectConversation, writeBucket],
  )

  // loadMoreSessions appends the next older page when the conversation list is
  // scrolled to the bottom.
  const loadMoreSessions = useCallback(() => {
    const agentId = selectedAgentRef.current
    if (!agentId) {
      return
    }
    const entry = entryFor(sessionListsRef.current, agentId)
    if (entry.loadingMore || !entry.hasMore) {
      return
    }
    // The page is only applied while no newer request for this agent has
    // started, so a refresh landing meanwhile cannot leave the offset stale.
    const gen = genByAgentRef.current[agentId] ?? 0
    writeBucket(agentId, { ...entry, loadingMore: true })
    // The offset counts server rows: `rows` is grouped and filtered, so its
    // length can never be used as an offset (that re-requested the same rows
    // forever, which is what made the spinner reappear on every scroll).
    listAgentSessions(agentId, { limit: SESSION_PAGE_SIZE, offset: entry.rawOffset })
      .then((page) => {
        if (agentId !== selectedAgentRef.current || (genByAgentRef.current[agentId] ?? 0) !== gen) {
          return
        }
        const current = entryFor(sessionListsRef.current, agentId)
        writeBucket(agentId, {
          ...current,
          rows: groupSessions(mergeSessionRows(current.rows, page.sessions)),
          segments: mergeSessionRows(current.segments, page.sessions),
          total: page.total,
          rawOffset: current.rawOffset + page.sessions.length,
          hasMore: page.has_more,
          loadingMore: false,
        })
      })
      .catch(() => {
        if ((genByAgentRef.current[agentId] ?? 0) === gen) {
          writeBucket(agentId, { ...entryFor(sessionListsRef.current, agentId), loadingMore: false })
        }
      })
  }, [writeBucket])

  // focusAgent moves the sidebar to an agent without touching the tab group: it
  // is the sidebar half of the two-way binding with the tabs.
  const focusAgent = useCallback(
    (agentId: string) => {
      if (selectedAgentRef.current !== agentId) {
        selectedAgentRef.current = agentId
        setSelectedAgent(agentId)
      }
      const state = convStore.getState()
      const active = state.tabs.find((tab) => tab.id === state.activeId)
      const next = active && active.agentId === agentId ? active.sessionId : null
      setSelectedSessionId((value) => (value === next ? value : next))
      loadSessionList(agentId)
    },
    [convStore, loadSessionList],
  )

  const selectAgent = useCallback(
    (agentId: string) => {
      focusAgent(agentId)
      let remembered = readActiveSession(agentId)
      // Drop a remembered conversation the list knows nothing about (a session id
      // the gateway handed out for a chat nobody ever sent anything into): opening
      // it would only earn a rejected handshake. Only judge this once the list has
      // actually been fetched.
      const entry = entryFor(sessionListsRef.current, agentId)
      if (remembered && entry.fetchedAt > 0) {
        const chatId = conversationKeyOf(remembered)
        const known =
          entry.rows.some((row) => row.id === remembered || row.chat_id === chatId) ||
          entry.segments.some((row) => row.chat_id === chatId)
        if (!known) {
          clearActiveSession(agentId)
          remembered = null
        }
      }
      openConversation(agentId, remembered)
    },
    [focusAgent, openConversation],
  )

  const refreshAgents = useCallback(() => {
    listAgents(accessToken)
      .then((result) => {
        setAgents(result)
        setAgentsError(null)
        writeListCache(userId, result, groupsRef.current, ungroupedRef.current, persistableLists(sessionListsRef.current))
        if (!selectedAgentRef.current && result.length > 0) {
          const first = result[0].id
          selectedAgentRef.current = first
          setSelectedAgent(first)
          setSelectedSessionId(readActiveSession(first))
          loadSessionList(first, { autoSelect: true })
        }
      })
      .catch((err: Error) => {
        setAgentsError(err.message)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [accessToken, loadSessionList, userId])

  const reloadAgents = useCallback(() => {
    setLoading(true)
    refreshAgents()
  }, [refreshAgents])

  // Groups come from the portal, the agent list from the gateway. A failed read
  // (an older portal, a deployment window) leaves the flat list in place rather
  // than emptying the sidebar.
  const refreshGroups = useCallback(() => {
    listAgentGroups()
      .then((snapshot) => {
        groupsRef.current = snapshot.groups
        setGroups(snapshot.groups)
        ungroupedRef.current = snapshot.ungrouped
        setUngrouped(snapshot.ungrouped)
        writeListCache(
          userId,
          agentsRef.current,
          snapshot.groups,
          snapshot.ungrouped,
          persistableLists(sessionListsRef.current),
        )
      })
      .catch(() => {
        groupsRef.current = []
        setGroups([])
        ungroupedRef.current = []
        setUngrouped([])
      })
  }, [userId])

  // Preselect an agent from the ?agent= URL param (e.g. returning from the
  // full-page files). This overrides the default first-agent selection once
  // the agents list is available.
  useEffect(() => {
    if (!paramAgent) {
      return
    }
    const match = agents.find((agent) => agent.id === paramAgent)
    if (!match) {
      return
    }
    selectedAgentRef.current = paramAgent
    // Syncing the selected agent with the ?agent= URL param is an intentional
    // external-state effect (returning from the full-page files).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedAgent(paramAgent)
    setSelectedSessionId(readActiveSession(paramAgent))
    loadSessionList(paramAgent, { autoSelect: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramAgent, agents])

  // Paint the sidebar from the local snapshot before the network answers. The
  // restored buckets are marked "needs revalidating", so the fetch below still
  // runs and silently corrects them.
  useEffect(() => {
    const snapshot = readListCache(userId)
    if (!snapshot || snapshot.agents.length === 0) {
      return
    }
    // Seeding from storage is an intentional external-state effect (the same
    // pattern as the ?agent= preselection below).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgents((current) => (current.length > 0 ? current : snapshot.agents))
    groupsRef.current = snapshot.groups
    ungroupedRef.current = snapshot.ungrouped
    // Seeding the groups from the same snapshot as the agents keeps the first
    // paint from showing every agent as ungrouped and then moving them.
    setGroups((current) => (current.length > 0 ? current : snapshot.groups))
    setUngrouped((current) => (current.length > 0 ? current : snapshot.ungrouped))
    setSessionLists((current) => {
      if (Object.keys(current).length > 0) {
        return current
      }
      const restored = restoredFromSnapshot(snapshot.lists)
      sessionListsRef.current = restored
      return restored
    })
    setLoading(false)
  }, [userId])

  useEffect(() => {
    refreshAgents()
    refreshGroups()
  }, [refreshAgents, refreshGroups])

  // One stored segment at a time. A segment is exactly one agent_sessions row,
  // so history is assembled from rows instead of pages of N messages: a
  // conversation compacted k times is k+1 reads in total, and no cursor has to
  // be tracked. There is no client cache — messages live in the pane that loaded
  // them and are dropped when the tab closes.
  const loadSegment = useCallback(async (sid: string, etag?: string): Promise<LoadedSegment> => {
    const read = await readAgentSession(sid, { etag })
    if (read.notModified) {
      // The server says the caller's copy is already current; the socket keeps
      // whatever it has (and there is no body to read metadata from).
      return {
        sessionId: sid,
        messages: [],
        previousSessionId: null,
        turnRunning: false,
        compacting: false,
        pendingQuestion: null,
        pendingApproval: null,
        notModified: true,
      }
    }
    const detail = read.detail
    const meta = parseSessionMeta(detail.meta)
    return {
      sessionId: sid,
      // Ids are derived from the segment id, so they stay stable across re-reads
      // and cannot collide with another segment's messages.
      messages: messagesFromProvider(parseProviderMessages(detail.messages), `hist-${sid}`, meta.pendingQuestion),
      previousSessionId: meta.previousSessionId ?? null,
      turnRunning: detail.turn_running ?? false,
      compacting: meta.compacting,
      mode: conversationModeOf(meta.sessionAgent),
      todos: meta.todos,
      pendingQuestion: meta.pendingQuestion,
      pendingApproval: meta.pendingApproval,
      etag: read.etag,
    }
  }, [])

  // There is no single chat runtime any more: every open conversation runs its
  // own (see ConversationPane), which is what makes switching between them
  // instant and lets a background conversation keep streaming.

  // The composer's build/plan mode lives with the conversation: the pane shows
  // its own pick, the mode the conversation's session records, or the agent's
  // default (see lib/agentMode). Nothing to clear here when a conversation is
  // started fresh — it has no session to read a mode from.

  // A reconnect picks up whatever token the host holds at that moment: the shell
  // owns the session and refreshes it for every caller, so this screen never
  // rotates the ticket itself (doing so twice used to sign other tabs out).

  // Safety net: keep the sessions list fresh even if a turn-complete callback
  // was missed (e.g. a message sent from another tab or a background agent
  // update). Poll only while the page is actually visible.
  useEffect(() => {
    if (!selectedAgent) {
      return
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadSessionList(selectedAgent, { force: true })
      }
    }, 30_000)
    return () => window.clearInterval(id)
  }, [selectedAgent, loadSessionList])

  // The attention snapshot has its own, faster cadence: it is the only source
  // for conversations this browser has no live view of (a turn started on
  // another device, a conversation whose tab was closed). Conversations that are
  // open here update from their own sockets, and a turn that just finished
  // refreshes the snapshot at once (see handleTurnComplete in ConversationPane),
  // so this interval only bounds how long another device's state can lag.
  useEffect(() => {
    refreshAttention()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshAttention()
      }
    }, 10_000)
    return () => window.clearInterval(id)
  }, [refreshAttention])

  // Keep every open conversation's bucket warm: switching to a tab then has its
  // sidebar row (and its title) already in memory, and the freshness window
  // keeps this from issuing a request per keystroke of activity.
  const openTabAgentKey = Array.from(new Set(conversationsState.tabs.map((tab) => tab.agentId))).sort().join('|')
  useEffect(() => {
    for (const agentId of openTabAgentKey.split('|')) {
      if (agentId) {
        loadSessionList(agentId)
      }
    }
  }, [openTabAgentKey, loadSessionList])

  const handleDeleteAgent = async () => {
    if (!deleteTarget) {
      return
    }
    setDeleteBusy(true)
    try {
      await deleteAgent(deleteTarget.id)
      toast.success(t('agent.agentDeleted'))
      if (selectedAgent === deleteTarget.id) {
        selectedAgentRef.current = null
        setSelectedAgent(null)
        setSelectedSessionId(null)
      }
      // Drop the deleted agent's list (and its snapshot entry).
      const next = withoutAgent(sessionListsRef.current, deleteTarget.id)
      sessionListsRef.current = next
      setSessionLists(next)
      writeListCache(userId, agentsRef.current, groupsRef.current, ungroupedRef.current, persistableLists(next))
      refreshAgents()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.deleteAgentFailed'))
    } finally {
      setDeleteBusy(false)
    }
  }

  // ---- agent groups ------------------------------------------------------

  const toggleGroup = useCallback((groupID: string) => {
    setCollapsedGroups((current) => {
      const next = current.includes(groupID)
        ? current.filter((id) => id !== groupID)
        : [...current, groupID]
      writeState('agentGroups', 'collapsed', next)
      return next
    })
  }, [])

  const createGroup = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const group = await createAgentGroup(name)
        const next = [...groupsRef.current, group]
        groupsRef.current = next
        setGroups(next)
        toast.success(t('agent.groups.created'))
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('agent.groups.failed'))
        return false
      }
    },
    [t],
  )

  const renameGroup = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      try {
        await renameAgentGroup(id, name)
        const next = groupsRef.current.map((group) => (group.id === id ? { ...group, name } : group))
        groupsRef.current = next
        setGroups(next)
        toast.success(t('agent.groups.renamed'))
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('agent.groups.failed'))
        return false
      }
    },
    [t],
  )

  const deleteGroup = useCallback(
    async (id: string) => {
      try {
        await deleteAgentGroup(id)
        const removed = groupsRef.current.find((group) => group.id === id)?.agents ?? []
        const nextGroups = groupsRef.current.filter((group) => group.id !== id)
        groupsRef.current = nextGroups
        setGroups(nextGroups)
        const nextUngrouped = [...ungroupedRef.current, ...removed]
        ungroupedRef.current = nextUngrouped
        setUngrouped(nextUngrouped)
        // The bus already unassigned them; mirror that locally so the rows move
        // to the ungrouped bucket without waiting for a refetch.
        setAgents((current) =>
          current.map((agent) => (agent.group_id === id ? { ...agent, group_id: '' } : agent)),
        )
        setCollapsedGroups((current) => {
          if (!current.includes(id)) {
            return current
          }
          const next = current.filter((groupId) => groupId !== id)
          writeState('agentGroups', 'collapsed', next)
          return next
        })
        toast.success(t('agent.groups.deleted'))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('agent.groups.failed'))
      }
    },
    [t],
  )

  const reorderGroups = useCallback(
    async (ids: string[]) => {
      const previous = groupsRef.current
      const byID = new Map(previous.map((group) => [group.id, group]))
      const next = ids
        .map((id, position) => {
          const group = byID.get(id)
          return group ? { ...group, position } : null
        })
        .filter((group): group is AgentGroup => group !== null)
      groupsRef.current = next
      setGroups(next)
      try {
        await reorderAgentGroups(ids)
      } catch (err) {
        groupsRef.current = previous
        setGroups(previous)
        toast.error(err instanceof Error ? err.message : t('agent.groups.failed'))
      }
    },
    [t],
  )

  // Moves an agent to a position in a group, or to the end when overAgentID is
  // null. The whole order is written in one request; the local state is updated
  // first and restored if the request fails.
  const commitAgentMove = useCallback(
    async (
      agentID: string,
      groupID: string,
      overAgentID: string | null,
      placement: 'before' | 'after',
    ) => {
      const previousGroups = groupsRef.current
      const previousUngrouped = ungroupedRef.current
      const previousAgents = agentsRef.current

      const nextGroups = previousGroups.map((group) => ({
        ...group,
        agents: group.agents.filter((id) => id !== agentID),
      }))
      const nextUngrouped = previousUngrouped.filter((id) => id !== agentID)
      if (groupID === '') {
        const index = overAgentID ? nextUngrouped.indexOf(overAgentID) : -1
        const at = index >= 0 ? (placement === 'before' ? index : index + 1) : nextUngrouped.length
        nextUngrouped.splice(at, 0, agentID)
      } else {
        const target = nextGroups.find((group) => group.id === groupID)
        if (!target) {
          return
        }
        const index = overAgentID ? target.agents.indexOf(overAgentID) : -1
        const at = index >= 0 ? (placement === 'before' ? index : index + 1) : target.agents.length
        target.agents.splice(at, 0, agentID)
      }

      groupsRef.current = nextGroups
      setGroups(nextGroups)
      ungroupedRef.current = nextUngrouped
      setUngrouped(nextUngrouped)
      setAgents((current) =>
        current.map((agent) => (agent.id === agentID ? { ...agent, group_id: groupID } : agent)),
      )

      try {
        await arrangeAgents(
          nextGroups.map((group) => ({ id: group.id, agents: group.agents })),
          nextUngrouped,
        )
      } catch (err) {
        groupsRef.current = previousGroups
        setGroups(previousGroups)
        ungroupedRef.current = previousUngrouped
        setUngrouped(previousUngrouped)
        setAgents(previousAgents)
        toast.error(err instanceof Error ? err.message : t('agent.groups.failed'))
      }
    },
    [t],
  )

  // The menu path (append to the target group) and the drag path share one
  // signature: overAgentID null means "at the end".
  const moveAgent = useCallback(
    (agentID: string, groupID: string, overAgentID: string | null = null, placement: 'before' | 'after' = 'after') =>
      void commitAgentMove(agentID, groupID, overAgentID, placement),
    [commitAgentMove],
  )

  const newAgentInGroup = useCallback((groupID: string) => {
    setEditingAgent(null)
    setFormGroupID(groupID)
    setFormOpen(true)
  }, [])

  // Selecting an agent that lives in a collapsed group must reveal it: the row
  // the sidebar is meant to highlight would otherwise be invisible.
  useEffect(() => {
    if (!selectedAgent) {
      return
    }
    const groupID = agents.find((agent) => agent.id === selectedAgent)?.group_id ?? ''
    if (!groupID || !collapsedGroups.includes(groupID)) {
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsedGroups((current) => {
      const next = current.filter((id) => id !== groupID)
      writeState('agentGroups', 'collapsed', next)
      return next
    })
  }, [selectedAgent, agents, collapsedGroups])

  const selected = agents.find((agent) => agent.id === selectedAgent) ?? null

  const hasProvisioning = agents.some((agent) => agent.status === 'provisioning' || agent.status === 'creating')

  useEffect(() => {
    if (!hasProvisioning) {
      return
    }
    const id = window.setInterval(() => refreshAgents(), 4000)
    return () => window.clearInterval(id)
  }, [hasProvisioning, refreshAgents])

  const handleRetry = useCallback(async () => {
    if (!selected) {
      return
    }
    try {
      await provisionAgent(selected.id)
      toast.success(t('agent.reprovisioning'))
      refreshAgents()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.reprovisionFailed'))
    }
  }, [selected, refreshAgents, t])

  const restartAgent = useCallback(
    async (agentId: string) => {
      setRestartAgentBusy(agentId)
      try {
        await restartAgentApi(agentId)
        toast.success(t('agent.restartRequested'))
        refreshAgents()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('agent.restartFailed'))
      } finally {
        setRestartAgentBusy(null)
      }
    },
    [refreshAgents, t],
  )

  const newConversation = useCallback(() => {
    if (!selectedAgent) {
      return
    }
    // A fresh conversation is a new tab: the previous one keeps running behind
    // it instead of being reset. Deliberately NOT reconciling sessions here —
    // a list refresh must not auto-select a session and pull the user back into
    // an old conversation.
    clearActiveSession(selectedAgent)
    // A fresh conversation starts in the agent's configured default mode with no
    // special handling: it has no session yet, so there is no remembered mode to
    // read (lib/agentMode).
    openConversation(selectedAgent, null)
  }, [openConversation, selectedAgent])

  const selectSession = useCallback(
    (sessionId: string) => {
      if (!selectedAgent) {
        return
      }
      openConversation(selectedAgent, sessionId)
    },
    [openConversation, selectedAgent],
  )

  const deleteSession = useCallback(
    async (sessionID: string) => {
      const agentId = selectedAgent
      setDeleteSessionBusy(sessionID)
      try {
        await archiveAgentSession(sessionID)
        toast.success(t('agent.sessionDeleted'))
        const chatId = conversationKeyOf(sessionID)
        // What the user is looking at, judged before the tabs go: the active tab
        // may be parked on an older segment than the row that was deleted, so this
        // compares conversation keys rather than session ids.
        const current = convStore.getState()
        const currentTab = current.tabs.find((tab) => tab.id === current.activeId)
        const wasCurrent = conversationKeyOf(currentTab?.sessionId ?? selectedSessionIdRef.current) === chatId
        // Close the tabs showing the archived conversation: an open tab whose
        // history no longer loads would only show an error. Match by conversation
        // key too, so a tab parked on an older segment is closed as well.
        //
        // The hand-over stays inside this agent. Closing the active tab activates
        // a neighbour, and the sidebar (plus files, git and the terminal, which
        // are all keyed on the selected agent) follows the active tab — a
        // neighbour from another agent would move the user somewhere they never
        // clicked.
        const tabIds = agentId ? convStore.idsForConversation(agentId, chatId) : []
        for (const tabId of new Set([...tabIds, ...convStore.idsForSession(sessionID)])) {
          convStore.close(tabId, { activateAgent: agentId ?? undefined })
        }
        if (agentId) {
          // The remembered conversation can be an older segment of the one just
          // archived, which is why this compares keys: the old equality check
          // against the row id missed it and left a resume that could only 403.
          if (conversationKeyOf(readActiveSession(agentId)) === chatId) {
            clearActiveSession(agentId)
          }
          if (wasCurrent) {
            // Stay in this agent. Fall back to the top of its conversation list,
            // and to no conversation at all when this was the last one — the
            // panel's empty state offers a new one, but the user starts it.
            const next = topConversationExcluding(entryFor(sessionListsRef.current, agentId).rows, chatId)
            if (next) {
              openConversation(agentId, next.id)
            } else {
              setSelectedSessionId(null)
            }
          }
          loadSessionList(agentId, { force: true })
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('agent.deleteSessionFailed'))
      } finally {
        setDeleteSessionBusy(null)
      }
    },
    [selectedAgent, loadSessionList, openConversation, convStore, t],
  )

  // The row to highlight: the active conversation. The sidebar follows the tab
  // group, so this is the conversation the user is actually looking at. The
  // comparison is by conversation key, not by session id: the list shows the
  // newest segment of a conversation while a tab may still be parked on an older
  // one, and those must still highlight as the same row.
  const activeTab = conversationsState.tabs.find((tab) => tab.id === conversationsState.activeId)
  const activeConversationKey = conversationKeyOf(activeTab?.sessionId ?? selectedSessionId)
  const activeTabAgentId = activeTab?.agentId ?? null
  const activeTabSessionId = activeTab?.sessionId ?? null

  // The tab group drives the sidebar: activating (or closing onto) a tab of
  // another agent selects that agent and its row. focusAgent never opens a tab,
  // so this cannot loop with selectAgent.
  useEffect(() => {
    if (!activeTabAgentId) {
      return
    }
    if (activeTabAgentId !== selectedAgentRef.current) {
      focusAgent(activeTabAgentId)
    }
    // Following the tab group is an intentional external-state effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSessionId((value) => (value === activeTabSessionId ? value : activeTabSessionId))
  }, [activeTabAgentId, activeTabSessionId, focusAgent])

  // Every tab header shows its conversation's real title, read from the bucket of
  // the tab's own agent. Doing it here rather than inside each pane means an
  // unmounted background tab is updated too, and a tab whose conversation moved
  // to a newer segment still finds its row — the pane looked the row up by the
  // exact segment id, so those tabs stayed on a stale title until they were
  // closed and reopened.
  useEffect(() => {
    for (const tab of conversationsState.tabs) {
      const rows = entryFor(sessionLists, tab.agentId).rows
      const row =
        (tab.chatId ? rows.find((session) => session.chat_id === tab.chatId) : undefined) ??
        rows.find((session) => session.id === tab.sessionId)
      if (row?.title && row.title !== tab.title) {
        convStore.setTitle(tab.id, row.title)
      }
    }
  }, [conversationsState.tabs, sessionLists, convStore])

  // Panels come from plugins.json: the shell's own six through the static map,
  // a plugin from another application through its manifest + remote entry.
  const { plugins: workbenchPlugins } = usePlugins(PANEL_MODULES, PANEL_ORDER)
  const { i18n: workbenchI18n } = useTranslation()
  const { resolvedTheme } = useTheme()
  const routerNavigate = useNavigate()
  // What a plugin from another application may know. Identity and navigation
  // stay the shell's: a panel never reads the router or storage itself.
  // A panel gets the same services a page does: the kit, the strings, the data
  // client and the notifications, plus the agent the workbench is focused on.
  const panelTranslate = useCallback(
    (key: string, options?: Record<string, unknown>) => workbenchI18n.t(key, options),
    [workbenchI18n],
  )
  const panelContext = useMemo(
    () => ({
      token: accessToken,
      userId,
      session: getHost().session ?? { user_id: userId },
      query: getHost().query ?? {},
      locale: workbenchI18n.language,
      theme: resolvedTheme,
      navigate: (path: string) => routerNavigate(path),
      agentId: selectedAgent ?? undefined,
      t: panelTranslate,
      ui: portalUI,
      api: portalApi,
      toast: { success: toast.success, info: toast.info, warning: toast.warning, error: toast.error },
    }),
    [accessToken, userId, workbenchI18n.language, resolvedTheme, routerNavigate, selectedAgent, panelTranslate],
  )

const workbenchValue = useMemo<AgentWorkbench>(
    () => ({
      selectedAgent,
      selected,
      agents,
      loading,
      agentsError,
      token: accessToken,
      userId,
      sessionLists,
      activeConversationKey,
      attention: attentionWithLive,
      restartAgentBusy,
      deleteSessionBusy,
      groups,
      ungrouped,
      collapsedGroups,
      toggleGroup,
      createGroup,
      renameGroup,
      deleteGroup,
      reorderGroups,
      moveAgent,
      newAgentInGroup,
      selectAgent,
      reloadAgents,
      newAgent: () => {
        setEditingAgent(null)
        setFormGroupID('')
        setFormOpen(true)
      },
      editAgent: (agent) => {
        setEditingAgent(agent)
        setFormGroupID('')
        setFormOpen(true)
      },
      deleteAgentTarget: setDeleteTarget,
      restartAgent,
      retryAgent: handleRetry,
      selectSession,
      deleteSession,
      retrySessions: () => {
        if (selectedAgent) {
          loadSessionList(selectedAgent, { autoSelect: true, force: true })
        }
      },
      newConversation,
      createFirstAgent: () => {
        setEditingAgent(null)
        setFormGroupID('')
        setFormOpen(true)
      },
      loadMoreSessions,
      ops: {
        openPanel: (id) => opsRef.current?.openPanel(id),
        closePanel: (id) => opsRef.current?.closePanel(id),
        activatePanel: (id) => opsRef.current?.activatePanel(id),
      },
    }),
    [
      selectedAgent, selected, agents, loading, agentsError, accessToken, userId, sessionLists,
      activeConversationKey, attentionWithLive, restartAgentBusy, deleteSessionBusy,
      groups, ungrouped, collapsedGroups, toggleGroup, createGroup, renameGroup, deleteGroup,
      reorderGroups, moveAgent, newAgentInGroup,
      selectAgent, reloadAgents, restartAgent, handleRetry, selectSession,
      deleteSession, loadSessionList, newConversation, loadMoreSessions,
    ],
  )

  // What the conversation runtime needs and the workbench chrome cannot get
  // from a tab body: the token, the history reader and the store itself.
  const conversationsValue = useMemo<ConversationsContextValue>(
    () => ({
      store: convStore,
      token: accessToken,
      loadSegment,
      loadSessionList,
      sessionLists,
      onSessionResolved,
      loadSessionMeta,
      refreshAttention,
    }),
    [convStore, accessToken, loadSegment, loadSessionList, sessionLists, onSessionResolved, refreshAttention],
  )
  return (
    <AgentWorkbenchProvider value={workbenchValue}>
      <ConversationsProvider value={conversationsValue}>
        <Card className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0">
          <Workbench plugins={workbenchPlugins} opsRef={opsRef} panelContext={panelContext} className="h-full min-h-0 w-full" />

          <AgentFormDialog
            key={formOpen ? (editingAgent?.id ?? 'create') : 'closed'}
            open={formOpen}
            onOpenChange={setFormOpen}
            agent={editingAgent}
            showUserPicker={false}
            defaultUserId={userId}
            groups={groups}
            defaultGroupID={formGroupID}
            onSaved={refreshAgents}
          />

          <ConfirmDialog
            open={!!deleteTarget}
            onOpenChange={(open) => {
              if (!open) {
                setDeleteTarget(null)
              }
            }}
            title={t('agent.deleteAgentTitle', { name: deleteTarget?.display_name || t('agent.agentFallback') })}
            description={t('agent.deleteAgentDescription')}
            confirmLabel={t('agent.deleteAgentConfirm')}
            busy={deleteBusy}
            onConfirm={handleDeleteAgent}
          />
        </Card>
      </ConversationsProvider>
    </AgentWorkbenchProvider>
  )
}

// SessionRow is one conversation row. Memoised because paging re-renders the
// whole list on every page: without it each row re-formats its timestamp
// (toLocaleString) on every pass, which is main-thread work on a phone.
const SessionRow = memo(function SessionRow({
  session,
  active,
  running,
  awaiting,
  unread,
  deleteBusy,
  language,
  onSelect,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  /** The conversation's turn is running (or its message is on the way out). */
  running: boolean
  /** The conversation is blocked on a question or an approval. */
  awaiting: boolean
  /** The conversation finished after this browser last read it. */
  unread: boolean
  deleteBusy: boolean
  language: string
  onSelect: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const updatedAt = useMemo(
    () => new Date(session.updated_at).toLocaleString(language),
    [session.updated_at, language],
  )
  return (
    <div
      data-session-id={session.id}
      data-conversation-key={conversationKeyOf(session.id)}
      className={cn('flex items-center rounded-md', active && 'bg-primary/10')}
    >
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className={cn(
          'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors',
          active ? 'text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          {/* The same three dots the agent row shows, so "which conversation is
              unread" is answerable without opening them one by one. */}
          <AttentionDots running={running} awaiting={awaiting} unread={unread} />
          <span className="truncate text-sm font-medium">{session.title || t('agent.newConversation')}</span>
        </span>
        <span className="block w-full truncate text-xs text-muted-foreground">{updatedAt}</span>
      </button>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('agent.sessionActions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('agent.sessionActions')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            className="text-destructive"
            disabled={deleteBusy}
            onSelect={() => onDelete(session.id)}
          >
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})

// AgentsPanel is the merged agent + session list panel (one plugin in the
// workbench). It keeps the old two-pane vertical layout. State comes from the
// workbench context, so the plugin is prop-free.

type AgentsPaneTab = 'sessions' | 'tasks'

function parseAgentsPane(value: unknown): AgentsPaneTab | null {
  return value === 'sessions' || value === 'tasks' ? value : null
}

function parseStringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
}

function parseReadAt(value: unknown): ReadAt | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const out: ReadAt = {}
  for (const [key, stamp] of Object.entries(value as Record<string, unknown>)) {
    if (typeof stamp === 'string') {
      out[key] = stamp
    }
  }
  return out
}

// Multi-tab merge for readAt: the later server timestamp wins, so a slow tab
// cannot move a conversation back to unread.
function mergeReadAt(fresh: ReadAt | null, next: ReadAt, previous: ReadAt | null): ReadAt {
  const out: ReadAt = { ...(fresh ?? {}), ...next }
  for (const [key, stamp] of Object.entries(out)) {
    const other = fresh?.[key]
    if (other && Date.parse(other) > Date.parse(stamp)) {
      out[key] = other
    }
  }
  void previous
  return out
}
function AgentsPanel() {
  const {
    agents,
    loading,
    agentsError,
    sessionLists,
    activeConversationKey,
    attention,
    selectedAgent,
    restartAgentBusy,
    deleteSessionBusy,
    groups,
    ungrouped,
    collapsedGroups,
    toggleGroup,
    createGroup,
    renameGroup,
    deleteGroup,
    reorderGroups,
    moveAgent,
    newAgentInGroup,
    selectAgent,
    reloadAgents,
    newAgent,
    editAgent,
    deleteAgentTarget,
    restartAgent,
    selectSession,
    deleteSession,
    retrySessions,
    newConversation,
    loadMoreSessions,
    ops,
  } = useWorkbench()
  const { t, i18n } = useTranslation()
  const buckets = useMemo(
    () => bucketAgents(agents, groups, ungrouped),
    [agents, groups, ungrouped],
  )
  const findGroup = (groupID: string) => groups.find((group) => group.id === groupID)
  const [groupDialog, setGroupDialog] = useState<{ mode: 'create' | 'rename'; group?: AgentGroup } | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<AgentGroup | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)
  // Drag follows the workbench's own pointer pattern (see workbench/Workbench.tsx).
  // It is pointer-based, so a touch screen gets it too: the grip carries
  // touch-action: none, which keeps the gesture from scrolling the list.

  // Resolve the element under the pointer: the section it belongs to is the
  // target group; a header also decides whether the dragged group lands before
  // or after it (the same "pointer side" rule the dock headers use).
  const resolveDrop = (x: number, y: number, kind: string) => {
    const element = document.elementFromPoint(x, y)
    const section = element?.closest('[data-agent-group-section]') as HTMLElement | null
    if (!section || section.dataset.agentGroupSection === undefined) {
      return null
    }
    const overID = section.dataset.agentGroupSection

    // A group drag lands before or after the whole section; an agent drag lands
    // before or after the row under the pointer, or at the end of the group.
    if (kind === 'group') {
      const rect = section.getBoundingClientRect()
      return { overID, placement: groupPlacement(y, rect.top, rect.height) }
    }
    const row = element?.closest('[data-agent-row]') as HTMLElement | null
    if (!row) {
      return { overID, overAgentID: null, placement: 'after' as const }
    }
    const rect = row.getBoundingClientRect()
    return {
      overID,
      overAgentID: row.dataset.agentRow ?? null,
      placement: groupPlacement(y, rect.top, rect.height),
    }
  }

  const commitDrop = (drop: PointerDrag) => {
    if (drop.kind === 'agent') {
      if (drop.overID !== null) {
        moveAgent(drop.id, drop.overID, drop.overAgentID, drop.placement ?? 'after')
      }
      return
    }
    if (drop.kind !== 'group' || !drop.overID || !drop.placement) {
      return
    }
    const next = moveGroupOrder(groups, drop.id, drop.overID, drop.placement)
    if (next) {
      void reorderGroups(next.map((group) => group.id))
    }
  }

  const { drag, begin } = usePointerDrag({
    enabled: true,
    resolve: resolveDrop,
    onCommit: commitDrop,
  })

  // Only the selected agent's bucket is rendered: rows of another agent can
  // never reach this list.
  const selectedEntry = entryFor(sessionLists, selectedAgent)
  const conversationList = selectedEntry.rows
  // Read as a plain boolean: the paging callback must not close over the bucket
  // object (the compiler cannot preserve the memoisation through it).
  const hasMoreSessions = selectedEntry.hasMore
  const sessionsListRef = useRef<HTMLDivElement | null>(null)
  // The pane choice is per account and survives a reload; it is read once so the
  // panel opens where the user left it.
  const [pane, setPane] = useState<AgentsPaneTab>(() =>
    readState<AgentsPaneTab>('agentsPane', 'tab', parseAgentsPane, 'sessions'),
  )

  // Keep the selected conversation visible when the active tab moves the
  // sidebar to another agent (or to an older entry).
  useEffect(() => {
    if (!activeConversationKey) {
      return
    }
    sessionsListRef.current
      ?.querySelector(`[data-conversation-key="${activeConversationKey}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeConversationKey])

  // Plain function, not useCallback: the compiler memoises it, and it keeps the
  // throttling ref write out of a manually memoised closure.
  const lastPagingRef = useRef(0)
  const handleSessionsScroll = () => {
    const el = sessionsListRef.current
    if (!el || !hasMoreSessions) {
      return
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight >= 120) {
      return
    }
    const now = Date.now()
    if (now - lastPagingRef.current < SESSION_SCROLL_THROTTLE_MS) {
      return
    }
    lastPagingRef.current = now
    loadMoreSessions()
  }

  // Selecting a conversation also reveals the chat: on a phone the chat would
  // otherwise switch behind the sidebar, and on a wide screen the chat panel may
  // be showing another plugin in its slot.
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      selectSession(sessionId)
      ops.activatePanel('chat')
    },
    [ops, selectSession],
  )

  const handleNewSession = () => {
    newConversation()
    ops.activatePanel('chat')
  }

  // Which half of the panel is showing: the agent's conversations or its
  // scheduled tasks. Both are per-agent lists, so they share the pane.
  const handlePaneChange = (next: string) => {
    const pane = next === 'tasks' ? 'tasks' : 'sessions'
    setPane(pane)
    writeState('agentsPane', 'tab', pane)
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card">
      <PanelGroup
        direction="vertical"
        storageKey={stateKey('layout', 'leftVert') ?? undefined}
        className="h-full min-h-0 w-full"
      >
        <Panel index={0} defaultSize={45} minSize={30} maxSize={75} className="min-h-0">
          <div className="flex h-full min-h-0 flex-col">
            {/* The count belongs to the heading, and "new agent" sits next to it;
                "new group" is a group-level action, so it is pushed to the right
                edge of the same row. */}
            <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3">
              <p className="text-xs font-medium text-muted-foreground">{t('agent.agents')}</p>
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {agents.length}
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={newAgent} aria-label={t('agent.newAgent')}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('agent.newAgent')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-6 w-6"
                    onClick={() => setGroupDialog({ mode: 'create' })}
                    aria-label={t('agent.groups.new')}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('agent.groups.new')}</TooltipContent>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)
              ) : agentsError ? (
                <div className="flex flex-col items-center gap-2 p-4 text-center">
                  <p className="text-sm text-destructive">{t('agent.loadAgentsFailed')}</p>
                  <Button variant="outline" size="sm" onClick={reloadAgents}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('common.retry')}
                  </Button>
                </div>
              ) : agents.length === 0 ? (
                <EmptyState icon={Bot} title={t('agent.noAgentsTitle')} description={t('agent.noAgentsCreate')} className="py-6" />
              ) : (
                buckets.map((bucket) => (
                  <AgentGroupSection
                    key={bucket.id || 'ungrouped'}
                    bucket={bucket}
                    collapsed={collapsedGroups.includes(bucket.id)}
                    dropTarget={drag?.kind === 'agent' && drag.overID === bucket.id}
                    groupDropLine={
                      drag?.kind === 'group' && drag.overID === bucket.id ? drag.placement : null
                    }
                    agentDropLine={
                      drag?.kind === 'agent' && drag.overID === bucket.id && drag.overAgentID
                        ? { agentID: drag.overAgentID, placement: drag.placement ?? 'after' }
                        : null
                    }
                    draggingID={drag?.id ?? null}
                    groups={groups}
                    selectedAgent={selectedAgent}
                    restartBusyId={restartAgentBusy}
                    onToggle={() => toggleGroup(bucket.id)}
                    onRename={() => {
                      const group = findGroup(bucket.id)
                      if (group) {
                        setGroupDialog({ mode: 'rename', group })
                      }
                    }}
                    onDelete={() => {
                      const group = findGroup(bucket.id)
                      if (group) {
                        setDeleteGroupTarget(group)
                      }
                    }}
                    onNewAgent={() => newAgentInGroup(bucket.id)}
                    onSelectAgent={selectAgent}
                    onRestartAgent={restartAgent}
                    onEditAgent={editAgent}
                    onDeleteAgent={deleteAgentTarget}
                    onMoveAgent={(agentID, groupID) => void moveAgent(agentID, groupID)}
                    onGripPointerDown={begin}
                  />
                ))
              )}
            </div>
          </div>
        </Panel>
        <PanelResizeHandle index={0} side="before" dots />
        <Panel index={1} className="min-h-0">
          <Tabs
            value={pane}
            onValueChange={handlePaneChange}
            className="flex h-full min-h-0 flex-col gap-0"
            data-agent-pane={pane}
          >
            <div className="flex h-8 shrink-0 items-center justify-between border-b px-2">
              <TabsList className="h-6 gap-0 bg-transparent p-0">
                <TabsTrigger
                  value="sessions"
                  className="h-6 px-2 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  {t('agent.tabs.sessions')}
                </TabsTrigger>
                <TabsTrigger
                  value="tasks"
                  className="h-6 px-2 text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  {t('agent.tabs.tasks')}
                </TabsTrigger>
              </TabsList>
              {pane === 'sessions' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewSession} aria-label={t('agent.newConversation')} disabled={!selectedAgent}>
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('agent.newConversation')}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <TabsContent
              value="sessions"
              ref={sessionsListRef}
              onScroll={handleSessionsScroll}
              className="m-0 min-h-0 flex-1 overflow-y-auto p-2"
            >
              {!selectedAgent ? (
                <p className="p-2 text-sm text-muted-foreground">{t('agent.selectAgentFirst')}</p>
              ) : selectedEntry.loading && selectedEntry.rows.length === 0 ? (
                Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)
              ) : selectedEntry.error ? (
                <div className="p-2">
                  <p className="text-sm text-muted-foreground">{t('agent.sessionsLoadFailed')}</p>
                  <p className="mt-1 break-all text-xs text-destructive">{selectedEntry.error}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={retrySessions}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    {t('common.retry')}
                  </Button>
                </div>
              ) : conversationList.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">{t('agent.noConversations')}</p>
              ) : (
                conversationList.map((session) => {
                  const dots = sessionAttention(attention, selectedAgent, session)
                  return (
                    <SessionRow
                      key={session.id}
                      session={session}
                      active={conversationKeyOf(session.id) === activeConversationKey}
                      running={dots.running}
                      awaiting={dots.awaiting}
                      unread={dots.unread}
                      deleteBusy={deleteSessionBusy === session.id}
                      language={i18n.language}
                      onSelect={handleSelectSession}
                      onDelete={deleteSession}
                    />
                  )
                })
              )}
              {selectedEntry.loadingMore ? (
                <div className="flex justify-center py-2">
                  <Spinner className="h-4 w-4" />
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="tasks" className="m-0 min-h-0 flex-1 overflow-y-auto p-2">
              <TaskList agentId={selectedAgent} rows={conversationList} onOpenSession={handleSelectSession} />
            </TabsContent>
          </Tabs>
        </Panel>
      </PanelGroup>

      <AgentGroupDialog
        key={groupDialog ? `${groupDialog.mode}:${groupDialog.group?.id ?? 'new'}` : 'closed'}
        open={!!groupDialog}
        title={groupDialog?.mode === 'rename' ? t('agent.groups.rename') : t('agent.groups.new')}
        initialName={groupDialog?.group?.name ?? ''}
        busy={groupBusy}
        onOpenChange={(open) => {
          if (!open) {
            setGroupDialog(null)
          }
        }}
        onSubmit={async (name) => {
          if (!groupDialog) {
            return
          }
          setGroupBusy(true)
          try {
            const ok =
              groupDialog.mode === 'rename' && groupDialog.group
                ? await renameGroup(groupDialog.group.id, name)
                : await createGroup(name)
            if (ok) {
              setGroupDialog(null)
            }
          } finally {
            setGroupBusy(false)
          }
        }}
      />

      <ConfirmDialog
        open={!!deleteGroupTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroupTarget(null)
          }
        }}
        title={t('agent.groups.deleteTitle', { name: deleteGroupTarget?.name ?? '' })}
        description={t('agent.groups.deleteDescription', {
          count: deleteGroupTarget
            ? (buckets.find((bucket) => bucket.id === deleteGroupTarget.id)?.agents.length ?? 0)
            : 0,
        })}
        confirmLabel={t('agent.groups.delete')}
        busy={groupBusy}
        onConfirm={async () => {
          if (!deleteGroupTarget) {
            return
          }
          setGroupBusy(true)
          try {
            await deleteGroup(deleteGroupTarget.id)
            setDeleteGroupTarget(null)
          } finally {
            setGroupBusy(false)
          }
        }}
      />
    </aside>
  )
}

// ChatPanel is the main conversation plugin: message window + composer.
// Low-frequency state comes from the workbench context; the chat stream
// (messages, busy, sockets) comes from the separate chat context so a
// ConversationTabs is the strip above the chat bodies: one tag per open
// conversation. Each tag names its agent (that is what tells two conversations
// apart) and carries a dot while the conversation is working or waiting for the
// user, so a background turn is never invisible.
function ConversationTabs({
  state,
  onActivate,
  onClose,
  onNew,
}: {
  state: ConversationsState
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-1">
      {state.tabs.map((tab) => {
        const summary = state.summaries[tab.id] ?? EMPTY_SUMMARY
        const active = tab.id === state.activeId
        return (
          <div
            key={tab.id}
            className={cn(
              'group flex h-6 max-w-56 shrink-0 items-center gap-1 rounded-md border pl-1.5 pr-0.5 text-xs',
              active
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent',
            )}
          >
            <button
              type="button"
              className="flex min-w-0 items-center gap-1"
              onClick={() => onActivate(tab.id)}
              title={`${tab.agentName}${tab.title ? ` · ${tab.title}` : ''}`}
            >
              {summary.busy ? (
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" title={t('agent.tabs.busy')} />
              ) : null}
              {summary.awaitingInput ? (
                <span className="size-1.5 shrink-0 rounded-full bg-info" title={t('agent.tabs.awaiting')} />
              ) : null}
              <span className="shrink-0 font-medium">{tab.agentName}</span>
              <span className="truncate opacity-70">{tab.title || t('agent.newConversation')}</span>
            </button>
            <button
              type="button"
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent',
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
              aria-label={t('agent.tabs.close')}
              title={t('agent.tabs.close')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"
        onClick={onNew}
        aria-label={t('agent.tabs.new')}
        title={t('agent.tabs.new')}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ConversationPane is one conversation's runtime: it owns the socket and the
// chat state, publishes the low-frequency summary the chrome reads, and renders
// the same chat body as before inside its own chrome context.
//
// Panes stay mounted while their tab is open — that is what makes switching
// instant (no reconnect, no reload) and lets a background conversation keep
// streaming. Only the active pane is displayed.
function ConversationPane({ tab, active, onConversationGone }: { tab: ConversationTab; active: boolean; onConversationGone: () => void }) {
  const { store, token, loadSegment, loadSessionList, sessionLists, onSessionResolved, loadSessionMeta, refreshAttention } = useConversations()
  const { agents } = useWorkbench()
  // The user's pick in this pane, and nothing else: the conversation's own
  // remembered mode is read from its session below, and the agent's default
  // covers a conversation that has not run a turn yet. Keeping the pick in a
  // state that outlives the session list refresh is what stops a background
  // metadata read from taking back a switch the user just made.
  const [manualMode, setManualMode] = useState<AgentMode | null>(null)

  // The session this pane's socket runs on. A conversation the gateway named for
  // a fresh chat keeps no session id on the tab (binding the tab to it would make
  // it re-read a segment the agent has not written yet), so the pane has to come
  // back to the session it was on when it mounts again — otherwise the gateway
  // answers a session-less connection with a brand-new conversation, and the
  // transcript comes back empty with only the newest stream in it.
  //
  // Frozen once, at mount: the id the running socket reports is recorded on the
  // tab for the *next* mount, and letting it flow back into this prop would tear
  // the live socket down on every turn of a fresh conversation.
  const [resumeSession, setResumeSession] = useState<string | null>(() => {
    const resolved = tab.sessionId ?? resolveResumeSession(entryFor(sessionLists, tab.agentId), tab)
    // The decision a reload makes: which session this pane will read, and what
    // it had to fall back on. Without it a blank transcript is indistinguishable
    // from a failed read.
    recordDiag('pane.mount', {
      tab: tab.id,
      chatID: tab.chatId ?? '(none)',
      tabSession: tab.sessionId ?? '(none)',
      resumeSession: tab.resumeSessionId ?? '(none)',
      resolved: resolved ?? '(none)',
    })
    return resolved
  })

  const handleModeChange = useCallback((mode: AgentMode) => {
    setManualMode(mode)
  }, [])

  // The socket reports a session it no longer knows. Usually that is an archived
  // segment (a compaction or /new moved the conversation on): re-point the tab at
  // the segment the sidebar shows instead of detaching it into a brand-new empty
  // conversation. When the conversation is really gone, close the tab.
  const handleInvalid = useCallback(() => {
    // What to do is decided by invalidSessionAction: only a bucket that was
    // fetched successfully may declare this conversation gone. Guessing from a
    // stale or failed bucket used to close the tab, which also moved the sidebar
    // to another agent (it follows the active tab) and made this agent look
    // unselectable.
    const action = invalidSessionAction(entryFor(sessionLists, tab.agentId), tab.chatId, tab.sessionId)
    recordDiag('tab.invalid', {
      tab: tab.id,
      sessionID: tab.sessionId ?? '(none)',
      chatID: tab.chatId ?? '(none)',
      action: action.kind,
    })
    switch (action.kind) {
      case 'repoint':
        store.setSession(tab.id, action.sessionId)
        return
      case 'close':
        onConversationGone()
        return
      default:
        // The bucket cannot tell us anything: keep the tab, drop what it was
        // showing, and do not leave a title behind for a conversation it no
        // longer displays. The frozen resume id goes with it — the server has
        // just rejected that session, and reconnecting to it would only earn the
        // same rejection.
        setResumeSession(null)
        store.setSession(tab.id, null)
        store.setTitle(tab.id, '')
    }
  }, [onConversationGone, sessionLists, store, tab.agentId, tab.chatId, tab.id, tab.sessionId])

  const handleTurnComplete = useCallback(() => {
    // Surface new conversations, titles and timestamps after a turn. Never
    // switches the active conversation.
    loadSessionList(tab.agentId, { force: true })
    // The turn just ended, so the server's snapshot is already up to date: read
    // it now instead of leaving the sidebar's running dot lit until the next
    // poll.
    refreshAttention()
  }, [loadSessionList, refreshAttention, tab.agentId])

  const handleSessionChanged = useCallback(
    (sessionId: string) => {
      // The agent moved the conversation to another session (a /new or a
      // compaction split). Record it on the tab — the pane's own props stay put,
      // so the transcript is not torn down and re-fetched.
      store.setSession(tab.id, sessionId)
      onSessionResolved(tab.agentId, sessionId)
      loadSessionList(tab.agentId, { force: true })
    },
    [store, tab.id, tab.agentId, onSessionResolved, loadSessionList],
  )

  // meta.handoff_from links the segments; rows written before it was recorded
  // fall back to the conversation's own rows in the sidebar list, so history does
  // not stop early.
  const resolvePreviousSegment = useCallback(
    (sessionId: string) => previousSegmentFallback(entryFor(sessionLists, tab.agentId).segments, sessionId),
    [sessionLists, tab.agentId],
  )

  // A stored segment is immutable once written, so a re-read after a reconnect
  // is answered by the persisted ETag (usually 304, which leaves the transcript
  // alone). There is no local cache: messages live in this pane.
  const chat = useAgent(
    GATEWAY_URL,
    token,
    tab.agentId,
    tab.sessionId ?? resumeSession,
    loadSegment,
    handleInvalid,
    handleTurnComplete,
    handleSessionChanged,
    loadSessionMeta,
    resolvePreviousSegment,
  )

  // What the composer's switch shows: this pane's pick, else what the conversation
  // last ran in (its own session, so it follows to another device), else the
  // agent's configured default.
  const agentMode: AgentMode = resolveAgentMode(
    manualMode,
    chat.conversationMode,
    defaultModeOf(agents.find((item) => item.id === tab.agentId)?.default_agent),
  )

  // The tab strip and the status bar only need these low-frequency facts: the
  // message arrays stay in here, so a streamed token never re-renders another
  // conversation's tab.
  // Deduces to a boolean so publishing once per streamed token is impossible.
  const started = chat.messages.length > 0

  useEffect(() => {
    store.publishSummary(tab.id, {
      busy: chat.busy || chat.serverRunning,
      connected: chat.connected,
      reconnecting: chat.reconnecting,
      error: chat.error,
      awaitingInput: Boolean(chat.pendingQuestion) || Boolean(chat.pendingApproval),
      contextUsage: chat.contextUsage,
      started,
    })
  }, [
    store,
    tab.id,
    chat.busy,
    chat.serverRunning,
    chat.connected,
    chat.reconnecting,
    chat.error,
    chat.pendingQuestion,
    chat.pendingApproval,
    chat.contextUsage,
    started,
  ])

  // The session the socket runs on belongs to the tab: a fresh conversation only
  // learns its id here, and without the conversation key the sidebar row it now
  // has could not be matched back to this tab (which used to open a second tab
  // for the same conversation). Only the key is recorded — binding the tab to the
  // session id would rebind the socket and re-read a segment that may not exist
  // yet (the row is written by the agent when it picks the message up).
  useEffect(() => {
    if (!chat.sessionId) {
      return
    }
    store.setChatId(tab.id, conversationKeyOf(chat.sessionId))
    // Remember the session the socket is on without binding the tab to it (see
    // setResumeSession): it is what this conversation resumes from after a reload.
    store.setResumeSession(tab.id, chat.sessionId)
    // Only remember a conversation that can actually be resumed: its row has to
    // exist and be the active one. A new conversation is named by the gateway
    // before anything is stored, and remembering that id made the next "click
    // this agent" resume a session with no row — which the gateway rejects, and
    // the recovery then closed the tab (the tab flashed and disappeared).
    if (isResumableSession(entryFor(sessionLists, tab.agentId), chat.sessionId)) {
      onSessionResolved(tab.agentId, chat.sessionId)
    }
  }, [store, tab.id, chat.sessionId, tab.agentId, sessionLists, onSessionResolved])

  // Label: the conversation's real title from its own agent's list, else the
  // first user message, so a conversation in the background is never nameless.
  const firstUserRef = useRef<string | null>(null)
  useEffect(() => {
    if (firstUserRef.current !== null) {
      return
    }
    const first = chat.messages.find((message) => message.role === 'user')
    if (first && first.role === 'user' && first.content.trim() !== '') {
      firstUserRef.current = first.content.trim().slice(0, 40)
      if (!tab.title) {
        store.setTitle(tab.id, firstUserRef.current)
      }
    }
  }, [chat.messages, store, tab.id, tab.title])

  const value = useMemo<ChatWorkbench>(
    () => ({
      active,
      connected: chat.connected,
      reconnecting: chat.reconnecting,
      error: chat.error,
      messages: chat.messages,
      busy: chat.busy,
      serverRunning: chat.serverRunning,
      statusEvent: chat.statusEvent,
      hasMoreHistory: chat.hasMoreHistory,
      unloadedSegments: chat.unloadedSegments,
      loadingOlder: chat.loadingOlder,
      loadOlder: chat.loadOlder,
      send: chat.send,
      sendCommand: chat.sendCommand,
      stop: chat.stop,
      todos: chat.todos,
      pendingQuestion: chat.pendingQuestion,
      pendingApproval: chat.pendingApproval,
      contextUsage: chat.contextUsage,
      fresh: tab.sessionId === null,
      answerQuestion: chat.answerQuestion,
      answerApproval: chat.answerApproval,
      agentMode,
      onModeChange: handleModeChange,
    }),
    [
      active,
      chat.connected,
      chat.reconnecting,
      chat.error,
      chat.messages,
      chat.busy,
      chat.serverRunning,
      chat.statusEvent,
      chat.hasMoreHistory,
      chat.unloadedSegments,
      chat.loadingOlder,
      chat.loadOlder,
      chat.send,
      chat.sendCommand,
      chat.stop,
      chat.todos,
      chat.pendingQuestion,
      chat.pendingApproval,
      chat.contextUsage,
      tab.sessionId,
      chat.answerQuestion,
      chat.answerApproval,
      agentMode,
      handleModeChange,
    ],
  )

  return (
    <ChatWorkbenchProvider value={value}>
      <ChatPanel />
    </ChatWorkbenchProvider>
  )
}

// ConversationHost is the chat panel: the tab strip plus one mounted pane per
// open conversation. Narrow viewports show a single conversation (no strip),
// matching the workbench's mobile layout.
function ConversationHost() {
  const { store } = useConversations()
  const { newConversation } = useWorkbench()
  const state = useConversationsState()
  const { t } = useTranslation()
  const narrow = useMediaQuery(NARROW_VIEWPORT)
  // A tab whose conversation no longer exists is closed. Closing it hands the
  // panel to a neighbour of the same agent only: anything else would move the
  // sidebar, and with it files, git and the terminal, on an agent the user never
  // picked. When that agent has no tab left the panel is legitimately empty, and
  // the empty state offers a new conversation instead of opening one unasked.
  const closeGoneConversation = useCallback(
    (tabId: string) => {
      const agentId = state.tabs.find((tab) => tab.id === tabId)?.agentId
      store.close(tabId, { activateAgent: agentId })
    },
    [state.tabs, store],
  )
  // Every open tab is mounted and stays mounted: each pane owns its socket, its
  // transcript and its scroll position, which is what makes switching instant
  // and lets a background conversation keep streaming. Restoring a group of tabs
  // therefore opens one connection per tab on purpose — the transcripts are what
  // the user switches between, and concurrent segment reads are limited by the
  // gate in useAgent.
  const panes = state.tabs

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!narrow ? (
        <ConversationTabs
          state={state}
          onActivate={(id) => store.activate(id)}
          onClose={(id) => store.close(id)}
          onNew={newConversation}
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        {panes.map((tab) => (
          <div
            key={tab.id}
            // A pane is never unmounted or re-keyed on a switch, and it never
            // loses its box either: both states share one geometry and only the
            // visibility differs, so the virtualised transcript keeps its
            // measurement and its scroll position (see lib/paneVisibility).
            className={cn('min-h-0', paneLayerClass(tab.id === state.activeId))}
            aria-hidden={paneLayerAriaHidden(tab.id === state.activeId)}
          >
            <ConversationPane
              tab={tab}
              active={tab.id === state.activeId}
              onConversationGone={() => closeGoneConversation(tab.id)}
            />
          </div>
        ))}
        {state.activeId === null ? (
          // No active tab is a real state now (the last conversation of an agent
          // was deleted, or the server dropped it): the panes above stay mounted —
          // closing a tab must not tear down the others' sockets — and this covers
          // them. An agent that still has tabs in the strip shows the same empty
          // panel here, with the way back in one click.
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6">
            <EmptyState
              icon={MessageSquare}
              title={t('agent.noConversationTitle')}
              description={t('agent.noConversationDescription')}
              action={
                <Button variant="outline" onClick={newConversation}>
                  <MessageSquarePlus className="h-4 w-4" />
                  {t('agent.newConversation')}
                </Button>
              }
              className="w-full"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

// streaming token never re-renders other plugins. The component stays mounted
// by the workbench portal host across dock moves, so the socket survives. All
// chrome (name tag, header actions, status bar) is contributed to the
// workbench; this body is deliberately chrome-free.
function ChatPanel() {
  const { selectedAgent, agents, loading, agentsError, reloadAgents, createFirstAgent } = useWorkbench()
  const { active, messages, connected, reconnecting, busy, serverRunning, statusEvent, taskProgress, hasMoreHistory, loadingOlder, loadOlder, send, todos, pendingQuestion, pendingApproval, answerQuestion, answerApproval, agentMode, onModeChange, fresh } = useChatWorkbench()
  const { t } = useTranslation()

  return loading ? (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <Spinner label={t('agent.loadingAgents')} />
    </div>
  ) : agentsError ? (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <EmptyState
        icon={Bot}
        title={t('agent.loadAgentsFailed')}
        description={agentsError}
        action={
          <Button variant="outline" onClick={reloadAgents}>
            <RefreshCw className="h-4 w-4" />
            {t('common.retry')}
          </Button>
        }
        className="w-full"
      />
    </div>
  ) : agents.length === 0 ? (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <EmptyState
        icon={Sparkles}
        title={t('agent.noAgentsTitle')}
        description={t('agent.noAgentsDescription')}
        action={
          <Button onClick={createFirstAgent}>
            <Plus className="h-4 w-4" />
            {t('agent.createFirstAgent')}
          </Button>
        }
        className="w-full"
      />
    </div>
  ) : selectedAgent ? (
    <AgentWindow
      fresh={fresh}
      active={active}
      agentId={selectedAgent}
      messages={messages}
      connected={connected}
      reconnecting={reconnecting}
      canSend={!!selectedAgent}
      working={busy || serverRunning}
      statusEvent={statusEvent}
      taskProgress={taskProgress}
      hasMoreHistory={hasMoreHistory}
      loadingOlder={loadingOlder}
      onLoadOlder={loadOlder}
      onSend={send}
      todos={todos}
      pendingQuestion={pendingQuestion}
      onAnswerQuestion={answerQuestion}
      pendingApproval={pendingApproval}
      onAnswerApproval={answerApproval}
      mode={agentMode}
      onModeChange={onModeChange}
    />
  ) : (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <EmptyState icon={Bot} title={t('agent.selectAgentTitle')} description={t('agent.selectAgentDescription')} className="w-full" />
    </div>
  )
}

// ChatHeaderActions contributes the retry button when the active agent failed.
function ChatHeaderActions() {
  const { selected, retryAgent } = useWorkbench()
  const { t } = useTranslation()
  if (selected?.status !== 'failed') {
    return null
  }
  return (
    <Button variant="outline" size="sm" className="h-7" onClick={retryAgent}>
      <RefreshCw className="h-3.5 w-3.5" />
      {t('common.retry')}
    </Button>
  )
}

// ChatStatusBar contributes the agent + connection line to the status bar's
// center section (the chat dock owns the center region).
function ChatStatusBar() {
  const { selected, selectedAgent } = useWorkbench()
  // The chat body lives inside the active conversation's own provider; the
  // status bar sits outside it and reads the published summary instead.
  const { summary } = useActiveConversation()
  const { connected, reconnecting, error } = summary
  const { t } = useTranslation()
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium text-foreground/80">{selected?.display_name || selectedAgent || t('nav.agent')}</span>
      <ConnectionPill selected={selected} connected={connected} reconnecting={reconnecting} error={error} />
    </span>
  )
}

// FilesPanel adapts the file browser to the workbench (agent id from context).
function FilesPanel() {
  const { selectedAgent } = useWorkbench()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <FilePanel agentId={selectedAgent} allowUpload />
    </div>
  )
}

// UserConfigPanel embeds the account-level configuration surface as a center-dock
// plugin (the dock name tag titles it, so the page header is omitted). Only one of
// its tabs is per agent, and that one follows the workbench's selected agent and
// pushes config-side selection back to the workbench so both stay in sync.
function UserConfigPanel() {
  const { selectedAgent, selectAgent } = useWorkbench()
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-card">
      <div className="mx-auto max-w-3xl p-4">
        <UserConfigPage embedded agentID={selectedAgent} onAgentChange={selectAgent} />
      </div>
    </div>
  )
}

// PANEL_MODULES is the static map the shell's own panels resolve through.
// Which of them exist, and in what order, comes from `portal/plugins.json`
// (see portal/registry.tsx); this map only supplies the implementations, which
// is what keeps P0 a pure refactor. Adding a shell panel = one map entry here,
// its component and its i18n key.
//
// Each panel is React.memo-wrapped so one panel's state churn cannot re-render
// the others; header/status pieces are declarative contributions the workbench
// renders (the dock header / status bar).
/**
 * GitPanel puts this module's git browser in a workbench dock.
 *
 * The browser reads the agent the workbench is focused on from the host (as it did
 * while it was the shell's panel), so the focused agent is installed on every
 * render — the same shape the shell used for a plugin panel.
 */
function GitPanel() {
  const { selectedAgent } = useWorkbench()
  setHost({ ...getHost(), agentId: selectedAgent ?? undefined })
  return <GitBrowserPanel />
}

// PANEL_ORDER is the order the manifest shipped them in: the layout a browser
// stored before the move (same panel ids, same keys) opens exactly as it was.
const PANEL_ORDER = ['agents', 'chat', 'files', 'terminal', 'user-config', 'git']

const PANEL_MODULES: Record<string, WorkbenchPlugin> = {
  agents: { id: 'agents', icon: Bot, titleKey: 'agent.agents', defaultSlot: 'left', Component: memo(AgentsPanel) },
  chat: { id: 'chat', icon: MessageSquare, titleKey: 'workbench.panel.chat', defaultSlot: 'center', Component: memo(ConversationHost), HeaderActions: ChatHeaderActions, StatusBar: ChatStatusBar, StatusBarRight: ChatStatusBarRight },
  files: { id: 'files', icon: FolderOpen, titleKey: 'nav.files', defaultSlot: 'right', Component: memo(FilesPanel) },
  terminal: { id: 'terminal', icon: SquareTerminal, titleKey: 'workbench.panel.terminal', defaultSlot: 'bottom', Component: memo(TerminalPanel), HeaderActions: TerminalHeaderActions, StatusBar: TerminalStatusBar },
  'user-config': { id: 'user-config', icon: Settings, titleKey: 'nav.userConfig', defaultSlot: 'center', Component: memo(UserConfigPanel) },
  // The git browser is this module's own panel (it lives in components/git); it
  // joins the workbench so the whole agent screen is one application.
  git: { id: 'git', icon: FolderTree, titleKey: 'workbench.panel.gitBrowser', defaultSlot: 'right', Component: memo(GitPanel) },
}

const SUGGESTION_KEYS = ['agent.suggestion1', 'agent.suggestion2', 'agent.suggestion3']

function ConnectionPill({
  selected,
  connected,
  reconnecting,
  error,
}: {
  selected: Agent | null
  connected: boolean
  reconnecting: boolean
  error: string | null
}) {
  const { t } = useTranslation()
  let label = t('agent.connecting')
  let tone = 'bg-warning/15 text-warning'
  if (selected?.status === 'provisioning' || selected?.status === 'creating') {
    label = t('agent.provisioning')
  } else if (selected?.status === 'failed') {
    label = t('agent.provisioningFailed')
    tone = 'bg-destructive/10 text-destructive'
  } else if (error) {
    label = error
    tone = 'bg-destructive/10 text-destructive'
  } else if (connected) {
    label = t('agent.connected')
    tone = 'bg-success/15 text-success'
  } else if (reconnecting) {
    label = t('agent.reconnecting')
  }
  return (
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', tone)}>
      {label}
    </span>
  )
}

function AgentWindow({
  agentId,
  active,
  messages,
  connected,
  reconnecting,
  canSend,
  working,
  statusEvent,
  taskProgress,
  hasMoreHistory,
  loadingOlder,
  fresh,
  onLoadOlder,
  onSend,
  todos,
  pendingQuestion,
  onAnswerQuestion,
  pendingApproval,
  onAnswerApproval,
  mode,
  onModeChange,
}: {
  active: boolean
  agentId: string | null
  messages: AgentMessage[]
  connected: boolean
  reconnecting: boolean
  canSend: boolean
  working: boolean
  statusEvent?: { event: string; state?: string; at: number } | null
  /** Delegated subagents currently running (live progress line). */
  taskProgress?: TaskProgress[]
  hasMoreHistory?: boolean
  loadingOlder?: boolean
  /** The tab holds a conversation that has not been stored yet (a new chat). */
  fresh?: boolean
  onLoadOlder?: () => void
  onSend: (content: string, mode?: AgentMode, media?: ChatMediaItem[]) => void
  todos: TodoItem[]
  pendingQuestion: PendingQuestion | null
  onAnswerQuestion: (answers: string[]) => void
  pendingApproval: PendingApproval | null
  onAnswerApproval: (decision: PermissionDecision) => void
  mode: AgentMode
  onModeChange: (mode: AgentMode) => void
}) {
  const paneRef = useRef<HTMLDivElement | null>(null)
  // The list is only mounted while the pane has a box. A virtual list measures
  // itself as it renders, and a pane in the workbench's vault has no box at all
  // (every measured height and scroll offset is zero), so mounting it there is
  // how a pane came back with its viewport somewhere it had never been.
  const laidOut = useIsLaidOut(paneRef, active)
  const listRef = useRef<VirtuosoHandle | null>(null)
  const applySuggestionRef = useRef<((value: string) => void) | null>(null)
  const [showTodos, setShowTodos] = useState(false)
  const [showJump, setShowJump] = useState(false)
  // Whether the viewport sits on the newest row. The list owns that answer: older
  // history lands above the reader as it is read, so "how far from the bottom" is
  // not a question scroll arithmetic can answer on its own.
  const atBottomRef = useRef(true)
  // Where the reader was, in the currency that survives prepends, lazy
  // measurement and a round trip through the vault: a row key plus the offset
  // inside it (see lib/transcriptPosition).
  const anchorRef = useRef<AnchorPosition | null>(null)
  // What the list is put back to when it is mounted again. State rather than a
  // ref because it is read *while rendering* — it becomes the list's
  // `initialTopMostItemIndex`, which is what keeps a pane from painting at the
  // top of the transcript and being moved a frame later.
  const [position, setPosition] = useState<TranscriptPosition>(BOTTOM_POSITION)

  const groups = useMemo(() => groupMessages(visibleMessages(messages)), [messages])
  const keys = useMemo(() => groups.map((group) => group.key), [groups])
  // The virtual index space (see lib/transcriptIndex). Older history is prepended
  // to the front of the list, and the library keeps the viewport by index, so the
  // first index has to follow the prepend — derived during render rather than in
  // an effect, because the data and the index have to change in the same commit:
  // an effect leaves one render in which the list is longer than the index space
  // it was numbered from, which visibly moves the newest rows.
  const [indexState, setIndexState] = useState(() => ({ first: BASE_FIRST_ITEM_INDEX, keys }))
  if (!sameKeys(indexState.keys, keys)) {
    setIndexState({ first: nextFirstItemIndex(indexState.first, indexState.keys, keys), keys })
  }

  // Where the pane should come back to is decided when it loses its box, not when
  // it gets one again: the reader's own scrolling is the only thing that moves the
  // position, and a pane nobody is looking at cannot be scrolled.
  useEffect(() => {
    if (laidOut) {
      return
    }
    setPosition(anchorRef.current && !atBottomRef.current ? anchorRef.current : BOTTOM_POSITION)
  }, [laidOut])

  const handleSuggestion = useCallback((value: string) => {
    applySuggestionRef.current?.(value)
  }, [])

  const components = useMemo(
    () => ({
      // The older history still on the server is a small loading row rather than
      // an estimated block of pixels: an honest scrollbar for a conversation whose
      // history is being read (which happens within seconds of opening it) is not
      // worth a viewport that can be parked in empty space. With nothing to load
      // it keeps the gap the transcript used to have above its first row.
      Header: () =>
        hasMoreHistory || loadingOlder ? (
          <div className="flex justify-center px-4 py-2">
            <Spinner className="h-4 w-4" />
          </div>
        ) : (
          <div className="h-4" />
        ),
    }),
    [hasMoreHistory, loadingOlder],
  )

  // The reader's row, read from the rendered rows themselves: the list measures
  // lazily, so the DOM is the only place that knows where a row currently sits.
  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const jump = distance > TRANSCRIPT_JUMP_DISTANCE_PX
      setShowJump((shown) => (shown === jump ? shown : jump))
      if (distance <= TRANSCRIPT_BOTTOM_THRESHOLD_PX) {
        anchorRef.current = null
        return
      }
      const scrollerTop = el.getBoundingClientRect().top
      const rects: RowRect[] = []
      for (const node of el.querySelectorAll<HTMLElement>('[data-item-index]')) {
        const key = keyAtIndex(indexState.first, keys, Number(node.dataset.itemIndex))
        if (!key) {
          continue
        }
        const box = node.getBoundingClientRect()
        rects.push({ key, top: box.top - scrollerTop, bottom: box.bottom - scrollerTop })
      }
      anchorRef.current = anchorFromRects(rects)
    },
    [indexState.first, keys],
  )

  const handleAtBottom = useCallback((atBottom: boolean) => {
    atBottomRef.current = atBottom
    if (atBottom) {
      // Back on the newest row: there is no row to come back to any more.
      anchorRef.current = null
    }
  }, [])

  const scrollToLatest = useCallback((behavior: 'auto' | 'smooth') => {
    anchorRef.current = null
    atBottomRef.current = true
    listRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior })
  }, [])

  // Retry re-sends the most recent user message after a failed turn (in the
  // same mode it was originally sent with).
  const lastUser = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'user') {
        return m
      }
    }
    return null
  }, [messages])
  // Sending is the reader asking for the latest: go there at once, and follow new
  // messages from then on.
  const handleSend = useCallback(
    (content: string, mode?: AgentMode, media?: ChatMediaItem[]) => {
      scrollToLatest('auto')
      onSend(content, mode, media)
    },
    [onSend, scrollToLatest],
  )

  const handleRetry = useCallback(() => {
    if (lastUser) {
      handleSend(lastUser.content, lastUser.mode)
    }
  }, [lastUser, handleSend])

  return (
    <div ref={paneRef} className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {laidOut ? (
          groups.length === 0 ? (
            // The welcome screen is the pane's own child, not the list's empty
            // placeholder: a list whose content is shorter than its viewport aligns
            // that content to the top (see the note on short transcripts below), and
            // the placeholder would have moved with the messages. Filling the pane
            // here is what keeps it centred.
            <div className="h-full min-h-0" data-welcome="">
              <WelcomeHero fresh={fresh} onSuggestion={handleSuggestion} />
            </div>
          ) : (
            // No padding on the scroller itself: the list measures the rows inside
            // it, and a padded scroller would fold that padding into its model. The
            // padding lives on the rows instead.
            <div className="h-full min-h-0" data-transcript="" data-transcript-position={position.mode}>
              <Virtuoso
                ref={listRef}
                data={groups}
                firstItemIndex={indexState.first}
                initialTopMostItemIndex={restoreTarget(position, (key) => indexOfKey(indexState.first, keys, key))}
                computeItemKey={(_, group) => group.key}
                itemContent={(_, group) => (
                  <div className="px-4 pb-4">
                    <MessageGroup group={group} onRetry={handleRetry} />
                  </div>
                )}
                components={components}
                // 40px of slack keeps the "am I following the newest row" answer the
                // same as it was when the transcript measured it itself.
                atBottomThreshold={TRANSCRIPT_BOTTOM_THRESHOLD_PX}
                atBottomStateChange={handleAtBottom}
                // Ask for older history when the reader reaches the top. The
                // background walk normally has it in memory already, so this is
                // mostly the retry affordance.
                startReached={() => onLoadOlder?.()}
                followOutput={(atBottom) => (atBottom ? 'auto' : false)}
                // A conversation shorter than the pane reads from the TOP: the first
                // message of a new conversation belongs beside the header, not pressed
                // against the composer. (The empty screen is rendered above, so it is
                // not affected.) This list was bottom-anchored for a release, which
                // put a brand-new conversation's only message at the very bottom.
                onScroll={handleScroll}
                // The browser's own scroll anchoring would fight the list's, and it
                // does not exist in Safari at all, so the list is the only anchor.
                style={{ overflowAnchor: 'none' }}
                className="h-full min-w-0"
              />
            </div>
          )
        ) : null}
      </div>
      <TodoPanel todos={todos} open={showTodos} />
      <IndicatorRow
        working={working}
        showJump={showJump}
        onGoToLatest={() => scrollToLatest('smooth')}
        todos={todos}
        onToggleTodos={() => setShowTodos((v) => !v)}
        showTodos={showTodos}
      />
      {statusEvent?.event === 'capabilities_reload' && (
        <ReloadPill key={statusEvent.at} state={statusEvent.state === 'applied' ? 'applied' : 'pending'} />
      )}
      {statusEvent?.event === 'session_switch' && (
        <SessionSwitchNotice key={statusEvent.at} state={statusEvent.state ?? 'compacted'} />
      )}
      {statusEvent?.event === 'session_sync' && <SessionSyncNotice key={statusEvent.at} />}
      {taskProgress && taskProgress.length > 0 ? <TaskProgressLine tasks={taskProgress} /> : null}
      {pendingQuestion ? <QuestionCard question={pendingQuestion} onSubmit={onAnswerQuestion} /> : null}
      {pendingApproval ? <ApprovalCard approval={pendingApproval} onSubmit={onAnswerApproval} /> : null}
      <Composer
        connected={connected}
        reconnecting={reconnecting}
        canSend={canSend}
        onSend={handleSend}
        mode={mode}
        onModeChange={onModeChange}
        agentId={agentId}
        applySuggestionRef={applySuggestionRef}
      />
    </div>
  )
}

// IndicatorRow is the always-visible status line between the message list and
// the composer: eight chasing working dots on the left, a centered
// "go to latest" icon button when the conversation is scrolled up, and the
// turn counter on the right.
function IndicatorRow({
  working,
  showJump,
  onGoToLatest,
  todos,
  showTodos,
  onToggleTodos,
}: {
  working: boolean
  showJump: boolean
  onGoToLatest: () => void
  todos: TodoItem[]
  showTodos: boolean
  onToggleTodos: () => void
}) {
  const { t } = useTranslation()
  const done = todos.filter((td) => td.status === 'completed').length
  return (
    <div className="relative flex h-8 shrink-0 items-center px-5 text-xs text-muted-foreground" aria-live="polite">
      <span
        className={cn('flex items-center gap-1', !working && 'composer-dots-idle')}
        aria-hidden="true"
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <span
            key={index}
            className="composer-dot size-1.5 rounded-full"
            style={{ '--dot-index': index } as React.CSSProperties}
          />
        ))}
      </span>
      {showJump ? (
        <button
          type="button"
          onClick={onGoToLatest}
          aria-label={t('agent.goToLatest')}
          title={t('agent.goToLatest')}
          className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <ArrowDown className="size-4" />
        </button>
      ) : null}
      {todos.length > 0 ? (
        <button
          type="button"
          onClick={onToggleTodos}
          aria-expanded={showTodos}
          className={cn(
            'ml-auto flex select-none items-center gap-1 rounded-md px-2 py-0.5 text-sm tabular-nums transition-colors hover:bg-accent hover:text-foreground',
            showTodos && 'bg-accent text-foreground',
          )}
        >
          {t('agent.todo.label')}
          {done}/{todos.length}
          <ChevronDown className={cn('size-3.5 transition-transform', showTodos && 'rotate-180')} />
        </button>
      ) : null}
    </div>
  )
}

// TodoPanel glides up above the indicator row when the TODO button is clicked.
function TodoPanel({ todos, open }: { todos: TodoItem[]; open: boolean }) {
  const { t } = useTranslation()
  if (todos.length === 0) {
    return null
  }
  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden border-t bg-card/60 transition-[max-height,opacity] duration-300 ease-out',
        open ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0',
      )}
      aria-hidden={!open}
    >
      <ul className="max-h-72 space-y-1 overflow-y-auto px-5 py-2 text-sm">
        {todos.map((td, i) => (
          <li key={i} className="flex items-start gap-2">
            <TodoStatusIcon status={td.status} />
            <span className={cn('min-w-0 flex-1', td.status === 'completed' && 'text-muted-foreground line-through')}>
              {td.content}
            </span>
            {td.priority ? (
              <span className="shrink-0 text-xs text-muted-foreground/70">{t(`agent.todo.priority.${td.priority}`, td.priority)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TodoStatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
  }
  if (status === 'in_progress') {
    return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
  }
  if (status === 'cancelled') {
    return <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
  }
  return <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
}

// QuestionCard renders a blocking question and collects the user's answer.
//
// The card is height-capped with the questions scrolling inside it, and the
// submit button stays outside that scroll. A model that asks many questions (or
// one with many options) used to make the card taller than the viewport, where
// the host clips it and the button with it — and the question waits with no
// timeout, so an unreachable button was a turn that could never finish.
//
// The cap is a share of the chat column (32% on a phone, 40% from `lg` up), not
// a viewport height: the options only make sense next to the conversation they
// refer to, and the old `min(70vh, 100% - 11rem)` left the transcript a strip a
// few dozen pixels tall on a phone — too narrow to read or select from.
// A share alone collapses on a very short viewport (a phone in landscape), so
// the cap is floored at 9rem: there the card keeps enough height for one
// question and the submit button instead of shrinking to a strip.
function QuestionCard({ question, onSubmit }: { question: PendingQuestion; onSubmit: (answers: string[]) => void }) {
  const { t } = useTranslation()
  // Touch devices have no hover: an option that carries a description shows it
  // on the first tap and selects on the second.
  const touchOnly = useMediaQuery(HOVERLESS_MEDIA)
  const [selected, setSelected] = useState<string[][]>(() => question.questions.map(() => []))
  const [customText, setCustomText] = useState<string[]>(() => question.questions.map(() => ''))
  // The option whose description is expanded (touch only), and which questions
  // have their free-text field open.
  const [hint, setHint] = useState<{ qi: number; label: string } | null>(null)
  const [customOpen, setCustomOpen] = useState<boolean[]>(() => question.questions.map(() => false))

  const toggle = (qi: number, label: string, multiple?: boolean) => {
    setSelected((prev) => {
      const next = prev.map((a) => [...a])
      const current = next[qi]
      const at = current.indexOf(label)
      if (at >= 0) {
        current.splice(at, 1)
      } else if (multiple) {
        current.push(label)
      } else {
        next[qi] = [label]
      }
      return next
    })
  }

  const tapOption = (qi: number, option: { label: string; description?: string }, multiple?: boolean) => {
    if (touchOnly && option.description && !(hint?.qi === qi && hint.label === option.label)) {
      setHint({ qi, label: option.label })
      return
    }
    toggle(qi, option.label, multiple)
  }

  const hintFor = (qi: number): string | null => {
    if (hint?.qi !== qi) {
      return null
    }
    return question.questions[qi]?.options?.find((option) => option.label === hint.label)?.description ?? null
  }

  const submit = () => {
    onSubmit(question.questions.map((_, qi) => composeAnswer(selected[qi], customText[qi])))
  }

  return (
    <div className="mx-4 mb-2 flex max-h-[max(9rem,32%)] shrink-0 flex-col rounded-lg border bg-card p-3 shadow-sm lg:max-h-[max(9rem,40%)]">
      <div className="mb-2 flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        <HelpCircle className="size-3.5" />
        {t('agent.question.title')}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
        {question.questions.map((q, qi) => {
          const hintText = hintFor(qi)
          const hasOptions = Boolean(q.options && q.options.length > 0)
          return (
            <div key={qi} className="space-y-1.5">
              {q.header ? <div className="text-xs font-semibold text-muted-foreground">{q.header}</div> : null}
              <div className="text-sm font-medium">{q.question}</div>
              {hasOptions ? (
                <div className="flex flex-wrap gap-1.5">
                  {q.options?.map((opt) => {
                    const active = selected[qi].includes(opt.label)
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        title={opt.description}
                        onClick={() => tapOption(qi, opt, q.multiple)}
                        className={cn(
                          'flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                          active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent',
                        )}
                      >
                        {opt.label}
                        {touchOnly && opt.description ? <HelpCircle className="size-3 opacity-60" /> : null}
                      </button>
                    )
                  })}
                  {/* The free-text entry point. When the tool already asked for one
                      (`custom`), the field itself is shown below instead — one
                      entry point per question, never two. */}
                  {q.custom ? null : (
                    <button
                      type="button"
                      onClick={() => setCustomOpen((prev) => prev.map((v, i) => (i === qi ? !v : v)))}
                      className={cn(
                        'rounded-md border border-dashed px-2.5 py-1 text-xs font-medium transition-colors',
                        customOpen[qi] || customText[qi].trim() !== ''
                          ? 'border-primary text-primary'
                          : 'hover:bg-accent',
                      )}
                    >
                      {t('agent.question.custom')}
                    </button>
                  )}
                </div>
              ) : null}
              {hintText ? <p className="text-[11px] text-muted-foreground">{hintText}</p> : null}
              {!hasOptions || q.custom || customOpen[qi] || customText[qi].trim() !== '' ? (
                <Input
                  value={customText[qi]}
                  autoFocus={customOpen[qi]}
                  onChange={(e) => setCustomText((prev) => prev.map((v, i) => (i === qi ? e.target.value : v)))}
                  placeholder={t('agent.question.placeholder')}
                  className="h-8 text-sm"
                />
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex shrink-0 justify-end">
        <Button size="sm" onClick={submit}>
          {t('agent.question.submit')}
        </Button>
      </div>
    </div>
  )
}

// ApprovalCard renders a permission prompt for a gated tool. It is deliberately
// separate from QuestionCard so the tool and the specific call detail (e.g. the
// bash command) are shown before the user allows it.
function ApprovalCard({ approval, onSubmit }: { approval: PendingApproval; onSubmit: (decision: PermissionDecision) => void }) {
  const { t } = useTranslation()
  const detail = approval.summary || approval.arguments
  return (
    <div className="mx-4 mb-2 shrink-0 rounded-lg border border-warning/50 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-warning-foreground">
        <AlertTriangle className="size-3.5" />
        {t('agent.approval.title')}
      </div>
      <div className="space-y-2">
        <div className="text-sm">{t('agent.approval.request', { tool: approval.tool })}</div>
        {detail ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 font-mono text-xs">
            {detail}
          </pre>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => onSubmit('deny')}>
          {t('agent.approval.deny')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onSubmit('allow_once')}>
          {t('agent.approval.allowOnce')}
        </Button>
        <Button size="sm" onClick={() => onSubmit('always_allow')}>
          {t('agent.approval.alwaysAllow')}
        </Button>
      </div>
    </div>
  )
}

// SessionSwitchNotice explains an automatic session boundary. Compaction
// archives the current segment and continues in a new one, so the transcript
// restarts even though the conversation did not — without this the switch read
// as unexplained message loss.
function SessionSwitchNotice({ state }: { state: string }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 6000)
    return () => window.clearTimeout(timer)
  }, [])
  if (!visible) {
    return null
  }
  let label = t('agent.sessionSwitch.compacted')
  if (state === 'reset') {
    label = t('agent.sessionSwitch.reset')
  } else if (state === 'redirected') {
    label = t('agent.sessionSwitch.redirected')
  }
  return (
    <div className="flex items-center gap-2 px-5 pb-1 text-xs text-muted-foreground" aria-live="polite">
      <Sparkles className="h-3 w-3" />
      {label}
    </div>
  )
}

// SessionSyncNotice warns that the conversation is not reaching the server.
//
// The JSONL transcript on the agent still works, so the agent keeps its memory —
// what breaks is the portal's copy, which stops advancing and would restore stale
// content. That asymmetry is exactly why the notice has to exist: nothing else in
// the UI looks different when the snapshot path is dead.
//
// It deliberately does NOT auto-hide. A lost-history condition should not fade out
// on its own; the agent re-emits the event each turn while the failure count keeps
// growing, and a turn that succeeds replaces it with whatever comes next.
function SessionSyncNotice() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 px-5 pb-1 text-xs text-destructive" aria-live="polite">
      <AlertTriangle className="h-3 w-3" />
      {t('agent.sessionSync.failed')}
    </div>
  )
}

// TaskProgressLine shows the subagents a delegation is currently running, so a
// long `task`/`readonly_task` call reports what it is doing instead of leaving
// the transcript silent.
function TaskProgressLine({ tasks }: { tasks: TaskProgress[] }) {
  const { t } = useTranslation()
  const label = (task: TaskProgress) =>
    task.state === 'tool'
      ? t('agent.taskProgress.runningTool', { name: task.detail ?? '' })
      : task.state === 'started'
        ? t('agent.taskProgress.started')
        : t('agent.taskProgress.thinking')

  return (
    <div className="flex flex-col gap-1 px-5 pb-1 text-xs text-muted-foreground" aria-live="polite">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-2">
          <Spinner className="h-3 w-3" />
          <span className="font-medium">{task.description || task.id}</span>
          <span>· {label(task)}</span>
          {task.detail && task.state !== 'tool' ? (
            <span className="truncate text-muted-foreground/70" title={task.detail}>
              {task.detail}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ReloadPill({ state }: { state: 'pending' | 'applied' }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    if (state !== 'applied') {
      return
    }
    const timer = window.setTimeout(() => setVisible(false), 4000)
    return () => window.clearTimeout(timer)
  }, [state])
  if (!visible) {
    return null
  }
  return (
    <div className="flex items-center gap-2 px-5 pb-1 text-xs text-muted-foreground" aria-live="polite">
      <Spinner className="h-3 w-3" />
      {state === 'pending' ? t('capabilities.reloading') : t('capabilities.updatedLabel')}
    </div>
  )
}

// The composer toolbar's fit ladder (see hooks/composerFit.ts). One candidate per
// property and tier, so an element never carries two conflicting utilities —
// Tailwind resolves those by stylesheet order, not by the order they appear in
// the class attribute. The strings stay literal because Tailwind finds
// candidates by scanning the source.
const TOOLBAR_TIER_CLASS = ['px-2 gap-2', 'px-1.5 gap-1.5', 'px-1.5 gap-1', 'px-1 gap-1']
const MODE_GROUP_TIER_CLASS = ['shrink-0', 'shrink-0', 'shrink-0', 'min-w-0 shrink overflow-hidden']
const MODE_BUTTON_TIER_CLASS = ['px-3 gap-1.5', 'px-2.5 gap-1', 'px-2.5 gap-1', 'px-2.5 gap-1']
const MODE_ICON_TIER_CLASS = ['size-3.5', 'size-3', 'size-3', 'size-3']
const INSTRUCTIONS_BUTTON_TIER_CLASS = ['px-2.5 gap-1.5', 'px-2 gap-1', 'px-2', 'px-2']
const INSTRUCTIONS_ICON_TIER_CLASS = ['size-3.5', 'size-3', 'size-3.5', 'size-3.5']
const TOOLBAR_TRAILING_TIER_CLASS = ['gap-1', 'gap-0.5', 'gap-0.5', 'gap-0.5']
// The tiers at which a trigger gives up its label (icons only, with the same text
// kept as the accessible name and the tooltip).
const INSTRUCTIONS_ICON_ONLY_TIER = 2
const MODE_ICON_ONLY_TIER = 3

function Composer({
  connected,
  reconnecting,
  canSend,
  onSend,
  mode,
  onModeChange,
  agentId,
  applySuggestionRef,
}: {
  connected: boolean
  reconnecting: boolean
  canSend: boolean
  onSend: (content: string, mode?: AgentMode, media?: ChatMediaItem[]) => void
  mode: AgentMode
  onModeChange: (mode: AgentMode) => void
  agentId: string | null
  applySuggestionRef: React.MutableRefObject<((value: string) => void) | null>
}) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatMediaItem[]>([])
  const [uploading, setUploading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { t, i18n } = useTranslation()
  const { selected } = useWorkbench()
  // active says whether this conversation is the one on screen: every open tab
  // stays mounted, so it is what keeps a shortcut press out of the other tabs.
  const { sendCommand, stop, busy, serverRunning, active } = useChatWorkbench()
  const working = busy || serverRunning
  // The toolbar's fit ladder: the row is measured and steps down until its
  // trailing controls sit inside the composer's border (see hooks/composerFit.ts).
  // The language belongs in the key because English labels are much wider than
  // the Chinese ones at the same pane width.
  const { ref: toolbarRef, tier } = useComposerFit<HTMLDivElement>(`${i18n.language}|${agentId ? 1 : 0}`)
  // The field's own height cap. The whole composer keeps the footprint it had
  // (200px): the toolbar band below the field takes the other 48px, so the field
  // may grow to 152px and the field+toolbar pair stops at 200px.
  const MAX_TEXTAREA_HEIGHT = 152

  useEffect(() => {
    applySuggestionRef.current = (value: string) => setDraft(value)
    return () => {
      applySuggestionRef.current = null
    }
  }, [applySuggestionRef])

  // The field grows with its content, up to the cap. The hook also refuses a
  // measurement taken while the pane is hidden (every conversation tab stays
  // mounted, and the whole panel lives in the workbench vault when it is not
  // shown), so a hidden composer can never be sized from a degenerate box.
  useAutoGrowTextarea(textareaRef, draft, MAX_TEXTAREA_HEIGHT)

  // ---- Voice input -------------------------------------------------------
  // The platform decides whether dictation exists at all (one platform-wide
  // setting set, no per-user override); the composer only renders it.
  const voiceConfig = useVoiceConfig()
  const voiceAvailable = voiceSupported() && !!voiceConfig?.enabled


  // These two are plain functions on purpose: the recorder reads them through a
  // ref, so their identity never matters, and memoising them only fights the
  // compiler's own inference.
  // The recorder hands back the provider's own words (or the socket's close
  // code) so a failure reads as something specific instead of "it broke".
  const withDetail = (message: string, detail?: string) =>
    detail ? message + t('composer.voice.detailSuffix', { detail }) : message

  const onVoiceResult = (result: VoiceResult) => {
    if (result.text.trim()) {
      setDraft((current) => joinDraft(current, result.text))
      }
    switch (result.warning) {
      case 'empty':
        toast.info(withDetail(t('composer.voice.heardNothing'), result.detail))
        break
      case 'polish_failed':
        toast.warning(withDetail(t('composer.voice.polishFailed'), result.detail))
        break
      case 'batch_failed':
        toast.warning(withDetail(t('composer.voice.batchFailed'), result.detail))
        break
      case 'batch_unavailable':
        toast.warning(withDetail(t('composer.voice.batchUnavailable'), result.detail))
        break
      case 'interrupted':
        toast.warning(withDetail(t('composer.voice.interrupted'), result.detail))
        break
    }
  }

  const onVoiceError = (code: VoiceErrorCode, detail?: string) => {
    switch (code) {
      case 'unsupported':
        toast.error(t('composer.voice.unsupported'))
        break
      case 'not_configured':
        toast.error(t('composer.voice.notConfigured'))
        break
      case 'mic_denied':
        toast.error(t('composer.voice.micDenied'))
        break
      case 'batch_failed':
        toast.warning(t('composer.voice.batchFailed'))
        break
      case 'batch_unavailable':
        toast.warning(t('composer.voice.batchUnavailable'))
        break
      default:
        toast.error(withDetail(t('composer.voice.unavailable'), detail))
    }
  }

  const voice = useRealtimeVoice({
    maxSeconds: voiceConfig?.max_seconds ?? 120,
    polishEnabled: !!voiceConfig?.polish.enabled,
    batch: {
      enabled: !!voiceConfig?.batch?.enabled,
      trigger: voiceConfig?.batch?.trigger ?? 'always',
      skipAfterBatch: !!voiceConfig?.polish?.skip_after_batch,
    },
    // 24 kHz is the OpenAI realtime contract; a local 16 kHz model asks for its
    // own rate through the platform config.
    audioRate: voiceConfig?.realtime?.audio_rate ?? 24000,
    onResult: onVoiceResult,
    onError: onVoiceError,
  })
  const {
    phase: voicePhase,
    transcript: voiceTranscript,
    elapsedMs: voiceElapsed,
    levelRef: voiceLevelRef,
    start: startVoice,
    stop: stopVoice,
    cancel: cancelVoice,
    refine: refineVoice,
    canRefine,
  } = voice
  const voiceActive = voicePhase !== 'idle'

  // Esc cancels a running dictation, the same as the ✕ on the recording strip.
  useEffect(() => {
    if (!voiceActive) {
      return
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelVoice()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voiceActive, cancelVoice])

  // One click starts the dictation, the next one ends it. There is no gesture
  // to learn: the button says what it will do, and ✕ (or Esc) throws the
  // recording away.
  const onMicClick = () => {
    if (voicePhase === 'idle') {
      if (working || !canSend) {
        return
      }
      startVoice()
      return
    }
    if (voicePhase === 'connecting' || voicePhase === 'recording' || voicePhase === 'reconnecting') {
      stopVoice()
    }
  }

  // ---- The dictation shortcut --------------------------------------------
  // The platform offers a default (voice.shortcut); a user may replace it for
  // their own keyboard in the preferences tab, and that override is tri-state
  // (see lib/shortcut.ts). The listener below is the same toggle as the button.
  const shortcutPlatform = voiceConfig?.shortcut ?? ''
  const shortcutOverride = useSyncExternalStore(
    subscribeShortcutOverride,
    getShortcutOverride,
    getShortcutOverride,
  )
  const shortcut = resolveShortcut(shortcutOverride, shortcutPlatform)
  const shortcutKeyLabel = shortcut ? shortcutLabel(shortcut, isMacPlatform()) : ''
  const composerRef = useRef<HTMLFormElement | null>(null)
  // The listener is bound once per shortcut and reaches the current toggle
  // through a ref, so a re-render never re-binds it and the rules stay in the
  // button's own function.
  const toggleVoiceRef = useRef(onMicClick)
  const stopIfLiveRef = useRef<() => void>(() => {})
  useEffect(() => {
    toggleVoiceRef.current = onMicClick
    stopIfLiveRef.current = () => {
      if (
        voicePhase === 'connecting' ||
        voicePhase === 'recording' ||
        voicePhase === 'reconnecting'
      ) {
        stopVoice()
      }
    }
  })

  useEffect(() => {
    if (!active || !voiceAvailable || !shortcut) {
      return
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || !matchesShortcut(shortcut, event)) {
        return
      }
      // A panel the workbench has put away is still mounted (the vault); a
      // dictation started there would record into a box nobody can see.
      if (!elementOnScreen(composerRef.current)) {
        return
      }
      event.preventDefault()
      toggleVoiceRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, voiceAvailable, shortcut])

  // One dictation at a time: moving to another conversation ends this one and
  // delivers its text into this pane's box, rather than leaving it recording
  // behind a tab nobody is looking at.
  const wasActiveRef = useRef(active)
  useEffect(() => {
    if (wasActiveRef.current && !active) {
      stopIfLiveRef.current()
    }
    wasActiveRef.current = active
  }, [active])

  // The phase rules live in voice/stageUi.ts: the dotted underline marks text
  // that is not final, and the marker at its end names the pass that is running
  // (batch, then polish).
  const stage = voiceStageUi(voicePhase, {
    batchEnabled: !!voiceConfig?.batch?.enabled,
    batchTrigger: voiceConfig?.batch?.trigger ?? 'always',
    polishEnabled: !!voiceConfig?.polish?.enabled,
  })

  const trailing = trailingAction({
    working,
    voice: voicePhase,
    voiceAvailable,
    hasDraft: !!draft.trim(),
    hasAttachments: attachments.length > 0,
  })

  const placeholder = voiceActive
    ? t('composer.voice.listening')
    : connected
      ? trailing === 'mic'
        ? t('agent.typeMessageWithVoice')
        : t('agent.typeMessage')
      : reconnecting
        ? t('agent.reconnectingPlaceholder')
        : t('agent.connectingPlaceholder')

  // addFiles uploads image attachments into the agent workspace and records
  // references to send with the message. Only references travel over the
  // WebSocket; the bytes are read by the agent at request time.
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!agentId) {
        return
      }
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) {
        return
      }
      setUploading(true)
      try {
        const uploaded: ChatMediaItem[] = []
        for (const file of images) {
          if (file.size > MAX_IMAGE_BYTES) {
            toast.error(t('composer.imageTooLarge', { name: file.name }))
            continue
          }
          const path = `uploads/${Date.now()}-${sanitizeFilename(file.name)}`
          await uploadFile(agentId, path, file)
          uploaded.push({ platform: 'local', url: path, mime_type: file.type, filename: file.name })
        }
        if (uploaded.length > 0) {
          setAttachments((current) => [...current, ...uploaded])
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(false)
      }
    },
    [agentId, t],
  )

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files)
      if (files.some((f) => f.type.startsWith('image/'))) {
        event.preventDefault()
        void addFiles(files)
      }
    },
    [addFiles],
  )

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, i) => i !== index))
  }

  const submitText = () => {
    const hasMedia = attachments.length > 0
    if ((!draft.trim() && !hasMedia) || !canSend || uploading || voiceActive) {
      return
    }
    onSend(draft, mode, attachments)
    setDraft('')
    setAttachments([])
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    submitText()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab (and Shift+Tab) flips Plan/Build without leaving the message box. Only
    // the bare key is taken over — a modifier combination or an IME in progress
    // still reaches the browser, and Tab keeps its usual meaning everywhere else
    // on the page.
    if (
      event.key === 'Tab' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      onModeChange(mode === 'build' ? 'plan' : 'build')
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submitText()
    }
  }

  return (
    <form ref={composerRef} onSubmit={submit} className="p-3 pt-1">
      <div className="relative w-full">
        <div className="pointer-events-none absolute -inset-px z-0 rounded-lg shadow-[0_0_14px_-6px] shadow-primary/20" aria-hidden />
        {attachments.length > 0 ? (
          <div className="relative z-10 mb-1 flex flex-wrap gap-1">
            {attachments.map((item, index) => (
              <span
                key={`${item.url}-${index}`}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs"
              >
                <ImagePlus className="size-3" />
                <span className="max-w-[160px] truncate">{item.filename}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  aria-label={t('composer.removeAttachment')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XCircle className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {/* The field and its toolbar are one bordered box: the field is what
            grows and scrolls, the toolbar overlays the box's bottom band. Having
            the toolbar share the *field's* box instead would let the browser
            scroll text — and the caret — into the band the toolbar covers, which
            is what put text between the buttons. The field's own bottom margin
            reserves that band, and the toolbar's opaque background hides
            anything scrolled behind it. */}
        <div className="relative z-10 w-full rounded-md border border-input bg-transparent shadow-sm focus-within:ring-2 focus-within:ring-ring">
          {voiceActive ? (
            /* While dictating the field is a read-only preview: the underline
               marks text that is not final yet, and the marker at its end names
               the pass that is running (the accurate model, then the polish
               brush). A textarea cannot hold an inline element, hence the swap —
               same box, same padding, so nothing jumps. */
            <div
              data-voice-preview=""
              data-voice-stage={stage.mark ?? ''}
              className="mb-12 min-h-[48px] max-h-[152px] w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-sm underline decoration-dotted underline-offset-4 decoration-muted-foreground"
            >
              {voiceTranscript ? (
                voiceTranscript
              ) : (
                <span className="text-muted-foreground no-underline">{placeholder}</span>
              )}
              {stage.mark === 'polish' ? (
                <Brush
                  data-voice-polishing=""
                  className="ml-1 inline size-3.5 animate-pulse align-text-bottom text-muted-foreground"
                  aria-label={t('composer.voice.polishing')}
                />
              ) : stage.mark === 'batch' ? (
                <Sparkles
                  data-voice-refining=""
                  className="ml-1 inline size-3.5 animate-pulse align-text-bottom text-muted-foreground"
                  aria-label={t('composer.voice.refining')}
                />
              ) : null}
            </div>
          ) : (
            <Textarea
              ref={textareaRef}
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={!canSend}
              className="mb-12 min-h-[48px] max-h-[152px] w-full resize-none rounded-none border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0"
            />
          )}
        </div>
        <div
          ref={toolbarRef}
          data-composer-toolbar=""
          data-fit={tier}
          className={cn(
            'absolute inset-x-px bottom-px z-20 flex h-11 items-center rounded-b-[7px] bg-card',
            TOOLBAR_TIER_CLASS[tier],
          )}
        >
          {/* The mode toggle, the instructions menu and the attach button step
              aside while a dictation is live: the row becomes the recording
              strip. Only the microphone stays mounted — it owns the pointer
              capture that keeps the hold gesture alive. */}
          <div
            role="group"
            aria-label={t('agent.modeToggle')}
            title={t('agent.modeToggleHint')}
            className={cn(
              'flex h-9 items-center gap-0.5 rounded-full border bg-muted/50 p-0.5 shadow-sm',
              MODE_GROUP_TIER_CLASS[tier],
              voiceActive && 'hidden',
            )}
          >
            <button
              type="button"
              onClick={() => onModeChange('build')}
              aria-pressed={mode === 'build'}
              aria-label={tier >= MODE_ICON_ONLY_TIER ? t('mode.build') : undefined}
              title={tier >= MODE_ICON_ONLY_TIER ? t('mode.build') : undefined}
              className={cn(
                'flex h-8 items-center rounded-full text-xs font-medium transition-colors',
                MODE_BUTTON_TIER_CLASS[tier],
                mode === 'build'
                  ? 'bg-primary/10 text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Zap className={MODE_ICON_TIER_CLASS[tier]} />
              {tier >= MODE_ICON_ONLY_TIER ? null : t('mode.build')}
            </button>
            <button
              type="button"
              onClick={() => onModeChange('plan')}
              aria-pressed={mode === 'plan'}
              aria-label={tier >= MODE_ICON_ONLY_TIER ? t('mode.plan') : undefined}
              title={tier >= MODE_ICON_ONLY_TIER ? t('mode.plan') : undefined}
              className={cn(
                'flex h-8 items-center rounded-full text-xs font-medium transition-colors',
                MODE_BUTTON_TIER_CLASS[tier],
                mode === 'plan'
                  ? 'bg-warning/15 text-warning-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Lightbulb className={MODE_ICON_TIER_CLASS[tier]} />
              {tier >= MODE_ICON_ONLY_TIER ? null : t('mode.plan')}
            </button>
          </div>
          {agentId ? (
            <div
              role="group"
              aria-label={t('composer.instructions.title')}
              className={cn(
                'flex h-9 shrink-0 items-center rounded-full border bg-muted/50 p-0.5 shadow-sm',
                voiceActive && 'hidden',
              )}
            >
              <InstructionsMenu onCommand={sendCommand} tier={tier} />
            </div>
          ) : null}
          {voiceActive ? (
            <RecordingMeter
              levelRef={voiceLevelRef}
              elapsedMs={voiceElapsed}
              phase={voicePhase}
              onCancel={cancelVoice}
            />
          ) : canRefine ? (
            /* The manual trigger's entry point: the take is still in memory, so
               the accurate model can be asked for on demand. */
            <button
              type="button"
              onClick={refineVoice}
              data-voice-refine=""
              className="flex h-8 shrink-0 items-center gap-1 rounded-full border bg-muted/50 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Sparkles className="size-3.5" />
              <span className="truncate">{t('composer.voice.refine')}</span>
            </button>
          ) : null}
          <div className={cn('ml-auto flex shrink-0 items-center', TOOLBAR_TRAILING_TIER_CLASS[tier])}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) {
                  void addFiles(event.target.files)
                }
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('composer.attach')}
              title={t('composer.attach')}
              disabled={!canSend || uploading}
              onClick={() => fileInputRef.current?.click()}
              className={cn('shrink-0 rounded-full', voiceActive && 'hidden')}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            </Button>
            <span className={cn(voiceActive && 'hidden')}>
              <ComposerSettingsMenu agent={selected} agentId={agentId} />
            </span>
            {trailing === 'mic' || trailing === 'mic-active' ? (
              <MicButton
                active={trailing === 'mic-active'}
                disabled={!canSend}
                label={
                  trailing === 'mic-active'
                    ? t('composer.voice.tapToStop')
                    : shortcutKeyLabel
                      ? t('composer.voice.tapToTalkWithKey', { key: shortcutKeyLabel })
                      : t('composer.voice.tapToTalk')
                }
                onClick={onMicClick}
              />
            ) : trailing === 'stop-turn' ? (
              <StopButton onStop={stop} />
            ) : trailing === 'spinner' ? (
              <Button
                type="button"
                size="icon"
                variant="default"
                disabled
                aria-label={voicePhase === 'polishing' ? t('composer.voice.polishing') : t('composer.voice.transcribing')}
                title={voicePhase === 'polishing' ? t('composer.voice.polishing') : t('composer.voice.transcribing')}
                className="shrink-0 rounded-full"
              >
                <Loader2 className="size-4 animate-spin" />
              </Button>
            ) : (
              <SendButton canSend={canSend && !uploading} hasContent={!!draft.trim() || attachments.length > 0} />
            )}
          </div>
        </div>
      </div>
    </form>
  )
}

// MicButton is the composer's hold-to-talk control. It is rendered for the whole
// dictation session — from press to result — because the pointer capture that
// keeps the gesture alive dies with the element, and because the live transcript
// must not be able to turn the slot into a Send button under the user's finger.
function MicButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <div className="relative shrink-0">
      <Button
        type="button"
        size="icon"
        variant={active ? 'destructive' : 'default'}
        data-composer-mic=""
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={(event: ReactMouseEvent) => event.preventDefault()}
        className={cn('shrink-0 rounded-full', active && 'animate-pulse')}
      >
        {active ? <Square className="size-3.5" /> : <Mic className="size-4" />}
      </Button>
    </div>
  )
}

// RecordingMeter is the strip that replaces the composer's tools while a
// dictation is live: a pulsing dot, the elapsed time, a level meter fed from the
// capture tap, and the phase.
const VOICE_METER_BARS = 14

function RecordingMeter({
  levelRef,
  elapsedMs,
  phase,
  onCancel,
}: {
  levelRef: React.MutableRefObject<number>
  elapsedMs: number
  phase: VoicePhase
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [bars, setBars] = useState<number[]>(() => new Array<number>(VOICE_METER_BARS).fill(0))

  // Sampling on a timer rather than per animation frame keeps this component
  // from re-rendering 60 times a second for a decoration.
  useEffect(() => {
    const id = window.setInterval(() => {
      setBars((current) => [...current.slice(1), levelRef.current])
    }, 70)
    return () => window.clearInterval(id)
  }, [levelRef])

  const seconds = Math.floor(elapsedMs / 1000)
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  const status =
    phase === 'recording'
      ? t('composer.voice.tapToStop')
      : phase === 'reconnecting'
        ? t('composer.voice.reconnecting')
        : phase === 'refining'
          ? t('composer.voice.refining')
          : phase === 'polishing'
            ? t('composer.voice.polishing')
            : t('composer.voice.transcribing')

  return (
    <div className="flex min-w-0 items-center gap-2" data-voice-meter="">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          phase === 'reconnecting' ? 'bg-muted-foreground' : 'animate-pulse bg-destructive',
        )}
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock}</span>
      <span className="flex h-4 items-end gap-0.5" aria-hidden>
        {bars.map((bar, index) => (
          <span
            key={index}
            className="w-0.5 rounded-full bg-destructive/70"
            style={{ height: `${Math.max(2, Math.round(bar * 16))}px` }}
          />
        ))}
      </span>
      <span className="truncate text-xs text-muted-foreground">{status}</span>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t('composer.voice.cancel')}
        title={t('composer.voice.cancel')}
        data-voice-cancel=""
        className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function SendButton({ canSend, hasContent }: { canSend: boolean; hasContent: boolean }) {
  const { t } = useTranslation()
  return (
    <Button
      type="submit"
      size="icon"
      variant="default"
      aria-label={t('common.send')}
      title={t('common.send')}
      disabled={!canSend || !hasContent}
      className="shrink-0 rounded-full"
    >
      <Send className="size-4" />
    </Button>
  )
}

// StopButton aborts the agent's in-flight turn.
function StopButton({ onStop }: { onStop: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      size="icon"
      variant="destructive"
      aria-label={t('common.stop')}
      title={t('common.stop')}
      onClick={onStop}
      className="shrink-0 rounded-full"
    >
      <Square className="size-3.5" />
    </Button>
  )
}

// COMPOSER_INSTRUCTIONS is the list of slash-command instructions offered by
// the composer. First: force context compaction.
const COMPOSER_INSTRUCTIONS = [
  { id: 'compact', labelKey: 'composer.instructions.compact', icon: Minimize2 },
] as const

// InstructionsMenu exposes agent instructions (slash commands) from the
// composer. It closes on outside click/Escape and fits its content. `tier` is the
// toolbar's fit ladder: from the icon-only tier on, the trigger keeps its icon
// and its accessible name but drops the label (see hooks/composerFit.ts).
function InstructionsMenu({ onCommand, tier }: { onCommand: (command: string) => void; tier: number }) {
  const { t } = useTranslation()
  const iconOnly = tier >= INSTRUCTIONS_ICON_ONLY_TIER
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDown = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('composer.instructions.title')}
        title={iconOnly ? t('composer.instructions.title') : undefined}
        className={cn(
          'flex h-8 items-center rounded-full text-xs font-medium transition-colors',
          INSTRUCTIONS_BUTTON_TIER_CLASS[tier],
          open ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Command className={cn('shrink-0', INSTRUCTIONS_ICON_TIER_CLASS[tier])} />
        {iconOnly ? null : t('composer.instructions.title')}
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-max min-w-[10rem] max-w-[min(20rem,90vw)] overflow-hidden rounded-lg border bg-card p-1 shadow-xl">
          {COMPOSER_INSTRUCTIONS.map((instruction) => {
            const Icon = instruction.icon
            return (
              <button
                key={instruction.id}
                type="button"
                onClick={() => {
                  onCommand(`/${instruction.id}`)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-accent"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                {t(instruction.labelKey)}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// ComposerSettingsMenu is the CPU-icon composer menu: a tabbed popover with
// Model (default), Skills and MCP sections. It replaces the separate
// model/thinking and capability pills so all screen sizes share one design.
function ComposerSettingsMenu({ agent, agentId }: { agent: Agent | null; agentId: string | null }) {
  const { t } = useTranslation()
  // The model and thinking rows below edit the current mode's record, so the
  // menu says which mode that is.
  const { agentMode } = useChatWorkbench()
  const [open, setOpen] = useState(false)
  const caps = useAgentCapabilities(agentId)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDown = (e: Event) => {
      const target = e.target as Element | null
      if (rootRef.current?.contains(target as Node)) {
        return
      }
      // Radix Select/Dropdown content portals to <body>; a click there must not
      // dismiss this popover (the nested menus live outside rootRef).
      if (target?.closest?.('[data-radix-popper-content-wrapper],[data-radix-select-content],[data-radix-menu-content]')) {
        return
      }
      setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggleOpen = () => {
    if (!open) {
      caps.load()
    }
    setOpen((v) => !v)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label={t('composer.more')}
        title={t('composer.more')}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full border bg-muted/50 shadow-sm transition-colors',
          open ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Cpu className="size-4" />
      </button>
      {open ? (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-max min-w-[14rem] max-w-[min(22rem,90vw)] overflow-hidden rounded-lg border bg-card shadow-xl">
          <Tabs defaultValue="model" className="gap-0">
            <TabsContent value="model" className="mt-0">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('composer.modelGroupFor', {
                    mode: agentMode === 'plan' ? t('userConfig.modePlan') : t('userConfig.modeBuild'),
                  })}
                </span>
                <ModelSelect agent={agent} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t px-3 py-2.5">
                <span className="text-xs font-medium text-muted-foreground">{t('thinking.label')}</span>
                <ThinkingLevelMenu agent={agent} />
              </div>
            </TabsContent>
            <TabsContent value="skills" className="mt-0">
              <CapabilityList data={caps.data} section="skills" busy={caps.busy} onToggle={caps.toggle} />
            </TabsContent>
            <TabsContent value="mcp" className="mt-0">
              <CapabilityList data={caps.data} section="mcp" busy={caps.busy} onToggle={caps.toggle} />
            </TabsContent>
            {/* The microphone is a device setting, so it lives with the other
                composer settings rather than on an admin page. */}
            <TabsContent value="mic" className="mt-0">
              <MicSettingsPanel />
            </TabsContent>
            <div className="flex items-center gap-1 border-t p-1">
              <TabsList className="flex-1 justify-center rounded-none bg-transparent p-0">
                <TabsTrigger value="model" className="flex-1 rounded-md text-xs data-[state=active]:shadow-none">
                  {t('composer.modelGroup')}
                </TabsTrigger>
                <TabsTrigger value="skills" className="flex-1 rounded-md text-xs data-[state=active]:shadow-none">
                  {t('composer.skills')}
                </TabsTrigger>
                <TabsTrigger value="mcp" className="flex-1 rounded-md text-xs data-[state=active]:shadow-none">
                  {t('composer.mcp')}
                </TabsTrigger>
                <TabsTrigger value="mic" className="flex-1 rounded-md text-xs data-[state=active]:shadow-none">
                  {t('composer.mic.tab')}
                </TabsTrigger>
              </TabsList>
              <button
                type="button"
                onClick={() => caps.load()}
                aria-label={t('composer.refresh')}
                title={t('composer.refresh')}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className={cn('size-3.5', caps.loading && 'animate-spin')} />
              </button>
            </div>
          </Tabs>
        </div>
      ) : null}
    </div>
  )
}

// ModelSelect picks the model for the current chat mode. Model (and thinking)
// now live per (agent, mode) in agent_type_overrides; this shares the same
// endpoints as Agent Config → Models so the two surfaces stay in sync. The menu
// it lives in names the mode for the same reason: the two surfaces edit
// different records whenever they are on different modes.
function ModelSelect({ agent }: { agent: Agent | null }) {
  const { t } = useTranslation()
  const { agentMode } = useChatWorkbench()
  const agentID = agent?.id ?? null
  const [allowed, setAllowed] = useState<TypeModelBinding[]>([])
  const [names, setNames] = useState<Record<number, string>>({})
  const [modelID, setModelID] = useState<number | undefined>(undefined)
  const [pending, setPending] = useState<string | null>(null)
  const value = pending ?? (modelID ? String(modelID) : FOLLOW_DEFAULT_VALUE)

  useEffect(() => {
    if (!agentID) return
    let cancelled = false
    void Promise.all([getAgentMode(agentID, agentMode), listMyModels()])
      .then(([mode, catalog]) => {
        if (cancelled) return
        setModelID(mode.override?.model_id || undefined)
        setAllowed(mode.type?.models ?? [])
        const next: Record<number, string> = {}
        for (const m of catalog.models ?? []) next[m.id] = m.name
        setNames(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agentID, agentMode])

  const onSelectModel = async (next: string) => {
    if (!agentID) return
    setPending(next)
    try {
      await setAgentMode(
        agentID,
        agentMode,
        next === FOLLOW_DEFAULT_VALUE ? { clear_model_id: true } : { model_id: Number(next) },
      )
      setModelID(next === FOLLOW_DEFAULT_VALUE ? undefined : Number(next))
      toast.success(t('models.saved'))
    } catch (err) {
      toast.error(String(err))
    } finally {
      setPending(null)
    }
  }

  // The "follow default" wording is composed inside the list builder, so the
  // entry can never render as a bare model name (which made it look like a
  // second copy of the default model).
  const optionLabels = {
    followDefault: (name: string) => t('composer.modelFollowDefault', { value: name }),
    fallback: t('agent.defaultModel'),
  }
  const options = modelSelectOptions(allowed, names, modelID, optionLabels)
  const current = modelSelectLabel(modelID, options, optionLabels)

  return (
    <Select value={value} onValueChange={(next) => void onSelectModel(next)} disabled={!agent}>
      <SelectTrigger
        title={current.label}
        className="h-8 w-auto max-w-[12rem] gap-1.5 rounded-full border-0 bg-transparent px-2 py-0 text-xs font-medium text-muted-foreground shadow-none hover:text-foreground focus:ring-0 [&>span]:truncate"
      >
        <Cpu className="size-3.5 shrink-0" />
        <SelectValue placeholder={t('agent.defaultModel')} />
      </SelectTrigger>
      <SelectContent className="max-w-[min(22rem,90vw)]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="text-xs">
            {option.label}
            {option.disabled && !option.followDefault ? ` ${t('userConfig.locked')}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// The composer's thinking row: the stored choice for the current (agent, mode),
// or "follow the default" — which is what the value resolves to when nothing is
// stored, and which the label spells out. The record is shared with the user
// config page's model tab, so the two always agree.
function ThinkingLevelMenu({ agent }: { agent: Agent | null }) {
  const { t } = useTranslation()
  const { agentMode } = useChatWorkbench()
  const { stored, resolved, loading, choose } = useThinkingLevel(agent?.id ?? null, agentMode)
  const levelLabel = (level: ThinkingLevel) => t(`thinking.${level}`)
  const sourceKey: Record<ResolvedThinking['source'], string> = {
    user: 'thinking.sourceUser',
    platform: 'thinking.sourcePlatform',
    model: 'thinking.sourceModel',
  }

  const select = (next: string) => {
    const choice: ThinkingChoice = next === INHERIT_THINKING ? '' : (next as ThinkingLevel)
    void choose(choice).catch((err) => toast.error(String(err)))
  }

  return (
    <Select value={stored || INHERIT_THINKING} onValueChange={select} disabled={loading}>
      <SelectTrigger
        aria-label={t('thinking.label')}
        title={t('thinking.source', {
          value: levelLabel(resolved.level),
          source: t(sourceKey[resolved.source]),
        })}
        className="h-8 w-auto max-w-[12rem] gap-1.5 rounded-full border-0 bg-transparent px-2 py-0 text-xs font-medium text-muted-foreground shadow-none hover:text-foreground focus:ring-0 [&>span]:truncate"
      >
        <Brain className="size-3.5 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-max min-w-[10rem]">
        <SelectItem value={INHERIT_THINKING} className="text-xs">
          {t('thinking.followDefault', { value: levelLabel(resolved.level) })}
        </SelectItem>
        {THINKING_LEVELS.map((item) => (
          <SelectItem key={item} value={item} className="text-xs">
            {levelLabel(item)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Radix Select cannot carry an empty value, so "follow the default" (which
// clears the stored level) is its own item.
const INHERIT_THINKING = '__inherit__'

// ContextRing is a small SVG ring showing context usage, with the used/limit
// figures in its tooltip.
function ContextRing({
  usagePct,
  used,
  limit,
  budget,
  threshold,
}: {
  usagePct: number
  used?: number
  limit?: number
  budget?: number
  threshold?: number
}) {
  const { t } = useTranslation()
  const pct = Math.max(0, Math.min(100, usagePct))
  // Auto-compaction fires at the threshold the agent reports with its usage
  // event, which is a configurable share of the prompt budget (window minus the
  // output reservation). Drawing our own 75% instead made the marker lie as soon
  // as that setting was anything else. Mark it, so a small percentage does not
  // read as "plenty of room" right before a compaction.
  const reported = compactThresholdPct({ threshold, budget, limit })
  const thresholdPct = reported != null && reported < 100 ? reported : undefined
  const R = 7
  const C = 2 * Math.PI * R
  const baseTitle =
    used != null && limit != null && limit > 0
      ? t('composer.contextUsed', { used: formatTokens(used), limit: formatTokens(limit), pct: Math.round(pct) })
      : t('composer.context')
  const title =
    thresholdPct != null ? `${baseTitle} · ${t('composer.contextCompactAt', { pct: Math.round(thresholdPct) })}` : baseTitle
  const thresholdAngle = thresholdPct != null ? (thresholdPct / 100) * 2 * Math.PI - Math.PI / 2 : 0
  return (
    <div className="flex h-5 shrink-0 items-center gap-1.5" title={title}>
      <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0 text-muted-foreground" aria-hidden>
        <circle cx="8" cy="8" r={R} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" />
        <circle
          cx="8"
          cy="8"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct / 100)}
          transform="rotate(-90 8 8)"
        />
        {thresholdPct != null ? (
          <line
            x1={8 + Math.cos(thresholdAngle) * (R - 3.6)}
            y1={8 + Math.sin(thresholdAngle) * (R - 3.6)}
            x2={8 + Math.cos(thresholdAngle) * (R + 2.4)}
            y2={8 + Math.sin(thresholdAngle) * (R + 2.4)}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1"
          />
        ) : null}
      </svg>
      <span className="text-[11px] tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  }
  return String(n)
}

// ChatStatusBarRight contributes global context usage to the footer's right edge.
function ChatStatusBarRight() {
  const { summary } = useActiveConversation()
  const { selected, selectedAgent } = useWorkbench()
  const { t } = useTranslation()
  const contextUsage = summary.contextUsage
  if (!selected && !selectedAgent) {
    return null
  }
  const usage = contextUsage ?? { used: 0, limit: 0, pct: 0 }
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{t('composer.contextLabel')}:</span>
      <ContextRing
        usagePct={usage.pct}
        used={usage.used}
        limit={usage.limit}
        budget={usage.budget}
        threshold={usage.threshold}
      />
    </span>
  )
}

// visibleMessages drops empty assistant rows (aborted or blank completions
// persisted by older code) so the transcript shows no blank bubbles.
function visibleMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter(
    (message) => !(message.role === 'assistant' && message.kind === 'content' && message.content.trim() === ''),
  )
}

// MessageGroup renders one virtual row: a collapsed think/tool run or a single
// message. The row wrapper lives in AgentWindow, which owns the virtualizer.
const MessageGroup = memo(function MessageGroup({
  group,
  onRetry,
}: {
  group: { key: string; run?: AgentMessage[]; message?: AgentMessage }
  onRetry: () => void
}) {
  if (group.run) {
    return (
      <RunBlock
        messages={group.run}
        streaming={group.run.some(
          (m) => m.role === 'assistant' && (m.kind === 'thought' || m.kind === 'tool_group') && m.streaming,
        )}
      />
    )
  }
  return <MessageBubble message={group.message as AgentMessage} onRetry={onRetry} />
})

// groupMessages merges each maximal consecutive run of assistant thought /
// tool_group messages into a single run so long think→tool chains render as one
// bubble (Note 13). Runs break on user messages, final content, or an error.
function groupMessages(messages: AgentMessage[]): { key: string; run?: AgentMessage[]; message?: AgentMessage }[] {
  const groups: { key: string; run?: AgentMessage[]; message?: AgentMessage }[] = []
  let run: AgentMessage[] = []
  const flush = () => {
    if (run.length === 0) {
      return
    }
    // A single thought/tool call renders as its own block (no merged wrapper):
    // wrapping one child produced an awkward nested collapse and a bubble that
    // did not hug its content.
    if (run.length === 1) {
      groups.push({ key: run[0].id, message: run[0] })
    } else {
      groups.push({ key: `run-${run[0].id}`, run })
    }
    run = []
  }
  for (const message of messages) {
    const isRunMessage =
      message.role === 'assistant' && (message.kind === 'thought' || message.kind === 'tool_group')
    if (isRunMessage) {
      run.push(message)
    } else {
      flush()
      groups.push({ key: message.id, message })
    }
  }
  flush()
  return groups
}

// RunBlock renders a merged think/tool run as one collapsed bubble with a live
// status line, expanding into the full thought + tool chain.
function RunBlock({ messages, streaming }: { messages: AgentMessage[]; streaming: boolean }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const thoughtMsgs = messages.filter(
    (m): m is Extract<AgentMessage, { kind: 'thought' }> => m.role === 'assistant' && m.kind === 'thought',
  )
  const toolMsgs = messages.filter(
    (m): m is Extract<AgentMessage, { kind: 'tool_group' }> => m.role === 'assistant' && m.kind === 'tool_group',
  )
  const toolCount = toolMsgs.reduce((n, m) => n + m.tools.length, 0)
  const totalMs = thoughtMsgs.reduce((n, m) => n + (m.elapsedMs ?? 0), 0)
  const last = messages[messages.length - 1]

  let label: string
  if (streaming) {
    label =
      last?.role === 'assistant' && last.kind === 'tool_group' ? t('agent.runningTool') : t('agent.thinking')
  } else {
    const parts: string[] = []
    if (thoughtMsgs.length > 0) {
      parts.push(t('agent.thoughtFor', { duration: (totalMs / 1000).toFixed(1) }))
    }
    if (toolCount > 0) {
      parts.push(`${toolCount} ${toolCount === 1 ? t('agent.toolUsedOne') : t('agent.toolUsedOther')}`)
    }
    label = parts.join(' · ') || t('agent.thinking')
  }

  return (
    <div className="flex justify-start">
      {/* Fit to content, at every level: the card is as wide as what it holds,
          and what it holds is what decides. Expanded, that means the width of the
          widest block inside it — not the width of the transcript. The cap is
          `max-w-full` (the row, which is definite), never a percentage of the
          card itself: a percentage cap on a shrink-to-fit box compounds with the
          parent's, which is how these labels ended up wrapping. */}
      <div className="w-fit min-w-0 max-w-full overflow-hidden break-words rounded-lg rounded-bl-sm border bg-muted/20 text-sm">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:bg-accent/60"
        >
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', expanded ? '' : '-rotate-90')} />
          {streaming ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : toolCount > 0 && thoughtMsgs.length === 0 ? (
            <Wrench className="h-3 w-3 shrink-0" />
          ) : (
            <Sparkles className="h-3 w-3 shrink-0" />
          )}
          {/* One line, always: "thinking 12.3s · 5 tools used" is short, and a
              wrapped label was the first thing that looked broken. */}
          <span className={cn('whitespace-nowrap text-xs font-medium', streaming && 'thinking-flash')}>{label}</span>
        </button>
        {expanded ? (
          <div className="space-y-2 border-t p-2">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onRetry={() => {}} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function WelcomeHero({ fresh, onSuggestion }: { fresh?: boolean; onSuggestion: (suggestion: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <div>
        <p className="text-lg font-semibold">{t('agent.welcomeTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('agent.welcomeDescription')}</p>
        {fresh ? (
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground/80">{t('agent.welcomeHint')}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {SUGGESTION_KEYS.map((key) => {
          const suggestion = t(key)
          return (
          <button
            key={key}
            type="button"
            onClick={() => onSuggestion(suggestion)}
            className="rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {suggestion}
          </button>
          )
        })}
      </div>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({
  message,
  onRetry,
}: {
  message: AgentMessage
  onRetry: () => void
}) {
  const isUser = message.role === 'user'
  if (isUser) {
    // The bubble is a pale tint carrying ordinary foreground text: the markdown
    // colours come from the theme's prose palette (dark:prose-invert included).
    // Forcing prose-invert here is what used to render light grey text on the
    // saturated primary, so the contrast was well under 4.5:1.
    return (
      <div className="flex justify-end">
        <div className="min-w-0 max-w-[75%] break-words rounded-lg rounded-br-sm border border-user-message-border bg-user-message px-3 py-2 text-sm leading-relaxed text-user-message-foreground [overflow-wrap:anywhere]">
          {message.content ? (
            <Suspense fallback={<p className="whitespace-pre-wrap">{message.content}</p>}>
              <Markdown>{message.content}</Markdown>
            </Suspense>
          ) : null}
        </div>
      </div>
    )
  }

  switch (message.kind) {
    case 'thought':
      return <ThoughtBlock message={message} />
    case 'tool_group':
      return <ToolGroupBlock message={message} />
    case 'question':
      return <QuestionBlock message={message} />
    case 'error':
      return <ErrorBubble category={message.category} detail={message.detail} onRetry={onRetry} />
    case 'stopped':
      return <StoppedBubble />
    case 'compaction':
      return <CompactionDivider summary={message.summary} streaming={message.streaming} />
    default:
      return (
        <div className="flex justify-start">
          <div className="min-w-0 max-w-full break-words rounded-lg rounded-bl-sm border bg-card px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
            {message.content ? (
              <Suspense fallback={<p className="whitespace-pre-wrap">{message.content}</p>}>
                <Markdown>{message.content}</Markdown>
              </Suspense>
            ) : message.streaming ? (
              <p>
                <span className="opacity-60">…</span>
              </p>
            ) : null}
          </div>
        </div>
      )
  }
})

// ThoughtBlock renders the agent's reasoning. Folded by default; the label
// flashes while thoughts stream and reads "Thought for Xs" once finished.
function ThoughtBlock({ message }: { message: Extract<AgentMessage, { kind: 'thought' }> }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const duration = message.elapsedMs != null ? (message.elapsedMs / 1000).toFixed(1) : null
  const label = message.streaming ? t('agent.thinking') : duration != null ? t('agent.thoughtFor', { duration }) : t('agent.thinking')
  return (
    <div className="flex justify-start">
      {/* Expanded it is as wide as the reasoning, capped by the row. */}
      <div className="w-fit min-w-0 max-w-full overflow-hidden break-words rounded-lg rounded-bl-sm border bg-muted/20 text-sm">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', expanded ? '' : '-rotate-90')} />
          <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className={cn('whitespace-nowrap text-xs font-medium text-muted-foreground', message.streaming && 'thinking-flash')}>{label}</span>
        </button>
        {expanded ? (
          <div className="border-t px-3 py-2">
            <Suspense fallback={<p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{message.content}</p>}>
              <Markdown className="text-xs leading-relaxed text-muted-foreground">{message.content}</Markdown>
            </Suspense>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ToolGroupBlock renders a folded "N tools used" chip with a pop on the count,
// expanding into the ordered list of tool calls and their results. The chip hugs
// its content with a light background, and so does the expanded card: it is as
// wide as the widest call in it, not as wide as the transcript.
function ToolGroupBlock({ message }: { message: Extract<AgentMessage, { kind: 'tool_group' }> }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const count = message.tools.length
  return (
    <div className="flex justify-start">
      <div className="w-fit min-w-0 max-w-full overflow-hidden break-words rounded-lg rounded-bl-sm border bg-muted/20 text-xs">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted-foreground hover:bg-accent/60"
        >
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', expanded ? '' : '-rotate-90')} />
          <Wrench className="h-3 w-3 shrink-0" />
          <span className="whitespace-nowrap font-medium">
            <span key={count} className="count-pop inline-block">
              {count}
            </span>{' '}
            {count === 1 ? t('agent.toolUsedOne') : t('agent.toolUsedOther')}
          </span>
        </button>
        {expanded ? (
          <ul className="w-full divide-y divide-border border-t">
            {message.tools.map((tool, index) => (
              <li key={index} className="min-w-0 px-3 py-2">
                {/* The call and its arguments get a line each: arguments are
                    long (a whole file, a command) and truncating them hid the
                    one thing the reader opened the card for. */}
                <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <Wrench className="h-3 w-3 shrink-0" />
                  <span className="whitespace-nowrap font-medium text-foreground/80">{tool.name}</span>
                </div>
                {tool.args ? (
                  <pre className="mt-1 max-w-full whitespace-pre-wrap font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    {formatToolArgs(tool.args)}
                  </pre>
                ) : null}
                {tool.result ? <ToolResultItem content={tool.result} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

// ToolResultItem renders a collapsed tool output block that expands on click.
// The label is a parameter because a question record shows its raw call and its
// raw result side by side.
function ToolResultItem({ content, label }: { content: string; label?: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-full overflow-hidden rounded-lg rounded-bl-sm border bg-muted/40 text-xs">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:bg-accent/60"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded ? '' : '-rotate-90')} />
          {label ?? t('agent.toolResult')}
        </button>
        {expanded ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 pb-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            {content}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

// QuestionBlock is the record of one `question` tool call: what the agent asked
// and what the user chose. It is deliberately not part of the tool chain — the
// answer is the only copy of the user's decision, and it is what somebody
// scrolling back is looking for (nanosec consumes the reply that carries the
// question id, so the answer never becomes a user message of its own).
//
// Always open, because a question is one or two short lines: folding it would
// hide exactly the content worth keeping. The raw call and the raw result stay
// available behind the same collapsible block the tool list uses.
function QuestionBlock({ message }: { message: Extract<AgentMessage, { kind: 'question' }> }) {
  const { t } = useTranslation()
  const pairs = useMemo(() => questionPairs(message.args, message.result) ?? [], [message.args, message.result])
  return (
    <div data-question-record="" className="w-fit min-w-0 max-w-full">
      <div className="overflow-hidden rounded-lg rounded-bl-sm border bg-muted/20 text-xs">
        <div className="flex items-center gap-1.5 border-b px-3 py-1.5 text-muted-foreground">
          <HelpCircle className="h-3 w-3 shrink-0" />
          <span className="whitespace-nowrap font-medium">{t('agent.question.record')}</span>
        </div>
        <ul className="divide-y divide-border">
          {pairs.map((pair, index) => (
            <li key={index} className="min-w-0 space-y-1.5 px-3 py-2">
              <div className="flex min-w-0 items-start gap-1.5">
                {pair.header ? (
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{pair.header}</span>
                ) : null}
                <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{pair.question}</span>
              </div>
              {/* The answer is the user's own words, so it wears the user message's
                  surface (pale tint, ordinary foreground). A primary tint reads as a
                  call to action, and on engines without color-mix() it renders as a
                  solid blue block — which is exactly how this card used to look. */}
              {pair.answer ? (
                <div
                  data-question-answer=""
                  className="rounded-md border border-user-message-border bg-user-message px-2 py-1 text-user-message-foreground"
                >
                  <div className="flex min-w-0 items-start gap-1.5">
                    <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{pair.answer}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed px-2 py-1 text-muted-foreground">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className={cn(message.streaming && 'thinking-flash')}>
                      {message.streaming ? t('agent.question.awaiting') : t('agent.question.unanswered')}
                    </span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t p-2">
          <ToolResultItem label={t('agent.toolArgs')} content={formatToolArgs(message.args)} />
          {message.result ? <ToolResultItem content={message.result} /> : null}
        </div>
      </div>
    </div>
  )
}

// StoppedBubble marks a turn the user stopped (neutral, not an error).
function StoppedBubble() {
  const { t } = useTranslation()
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-lg rounded-bl-sm border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <Square className="h-3 w-3" />
        {t('agent.stopped')}
      </div>
    </div>
  )
}

// CompactionDivider marks a context-compaction boundary. It behaves like a
// think/tool run: collapsed by default — the flashing label and spinner are the
// progress indicator — and click-to-reveal, before the summary finishes as well
// as after. Forcing it open while the summary streamed made the one block that
// behaves differently from every other one.
function CompactionDivider({ summary, streaming }: { summary: string; streaming?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hasSummary = summary.trim() !== ''
  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-3 rounded py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1">
          {streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Minimize2 className="h-3 w-3" />}
          <span className={cn(streaming && 'thinking-flash')}>
            {streaming ? t('agent.compacting') : t('agent.compaction')}
          </span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', open ? '' : '-rotate-90')} />
        </span>
        <span className="h-px flex-1 bg-border" />
      </button>
      {open ? (
        hasSummary ? (
          <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <Suspense fallback={<p className="whitespace-pre-wrap">{summary}</p>}>
              <Markdown className="text-xs leading-relaxed text-muted-foreground">{summary}</Markdown>
            </Suspense>
          </div>
        ) : (
          <div className="px-3 py-1 text-xs text-muted-foreground">
            <span className="opacity-60">…</span>
          </div>
        )
      ) : null}
    </div>
  )
}

// ErrorBubble renders a failed turn inline in the message flow: localized
// category text, the sanitized detail (if any), and a retry affordance. It is
// intentionally part of the transcript so the failure is visible on every
// screen size — the header pill only covers connection-level problems.
function ErrorBubble({ category, detail, onRetry }: { category: string; detail: string; onRetry: () => void }) {
  const { t } = useTranslation()
  const message = t(`enums.llmError.${category}`, { defaultValue: t('enums.llmError.internal') })
  return (
    <div className="flex justify-start">
      <div className="w-fit min-w-0 max-w-[85%] break-words rounded-lg rounded-bl-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm [overflow-wrap:anywhere]">
        <div className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">{message}</span>
        </div>
        {detail ? <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">{detail}</p> : null}
        <Button variant="outline" size="sm" className="mt-2 h-7 px-2.5 text-xs" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
          {t('agent.errorRetry')}
        </Button>
      </div>
    </div>
  )
}
