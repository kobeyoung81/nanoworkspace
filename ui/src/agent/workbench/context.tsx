/* eslint-disable react-refresh/only-export-components */
// Context modules export providers alongside hooks/consumers by design; the
// fast-refresh boundary concern does not apply to this singleton module.
import { createContext, useContext, type ReactNode } from 'react'
import type { Agent } from '../lib/agentApi'
import type { AgentGroup } from '../lib/agentGroups'
import type { SessionLists } from '../conversations/sessionLists'
import type { AttentionIndex } from '../conversations/attention'
import type { AgentMessage, AgentMode, ChatMediaItem, ContextUsage, PendingApproval, PendingQuestion, PermissionDecision, TaskProgress, TodoItem } from '../hooks/useAgent'

// PanelOps lets a plugin act on the workbench from inside (open/close/activate
// any panel, e.g. "select an agent first" opening the Agents panel). The
// Workbench registers its real implementation through opsRef.
export type PanelOps = {
  openPanel: (id: string) => void
  closePanel: (id: string) => void
  activatePanel: (id: string) => void
}

// AgentWorkbench is the low-frequency, agent-scoped state every panel cares
// about. It is what makes plugins prop-free: a panel reads useWorkbench().
export type AgentWorkbench = {
  selectedAgent: string | null
  selected: Agent | null
  agents: Agent[]
  loading: boolean
  agentsError: string | null
  token: string
  userId: string

  /** Every agent's conversation list, keyed by agent id (see sessionLists.ts). */
  sessionLists: SessionLists
  /**
   * Which conversations are running or waiting for the user, keyed by
   * conversation and unioned per agent (see conversations/attention.ts).
   */
  attention: AttentionIndex
  /** Conversation key (segment version stripped) of the active tab, if any. */
  activeConversationKey: string | null
  restartAgentBusy: string | null
  deleteSessionBusy: string | null

  /** The user's private, single-level agent groups, in display order. */
  groups: AgentGroup[]
  /** Agent ids in the ungrouped bucket, in display order. */
  ungrouped: string[]
  /** Group ids the sidebar has collapsed (per account, kept in the browser). */
  collapsedGroups: string[]
  toggleGroup: (groupID: string) => void
  createGroup: (name: string) => Promise<boolean>
  renameGroup: (id: string, name: string) => Promise<boolean>
  deleteGroup: (id: string) => Promise<void>
  /** Rewrites the group order; ids must name every group exactly once. */
  reorderGroups: (ids: string[]) => Promise<void>
  /**
   * Moves one agent into a group at a position; "" takes it out of every group.
   * overAgentID null appends to the end.
   */
  moveAgent: (
    agentID: string,
    groupID: string,
    overAgentID?: string | null,
    placement?: 'before' | 'after',
  ) => void
  newAgentInGroup: (groupID: string) => void

  selectAgent: (id: string) => void
  reloadAgents: () => void
  newAgent: () => void
  editAgent: (agent: Agent) => void
  deleteAgentTarget: (agent: Agent) => void
  restartAgent: (id: string) => void
  retryAgent: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  retrySessions: () => void
  newConversation: () => void
  createFirstAgent: () => void
  loadMoreSessions: () => void
  ops: PanelOps
}

const AgentWorkbenchCtx = createContext<AgentWorkbench | null>(null)

export function AgentWorkbenchProvider({ value, children }: { value: AgentWorkbench; children: ReactNode }) {
  return <AgentWorkbenchCtx.Provider value={value}>{children}</AgentWorkbenchCtx.Provider>
}

export function useWorkbench(): AgentWorkbench {
  const value = useContext(AgentWorkbenchCtx)
  if (!value) {
    throw new Error('useWorkbench must be used inside AgentWorkbenchProvider')
  }
  return value
}

// ChatWorkbench carries the chat stream state (high-frequency: every chunk).
// It is a separate context so a streaming token never re-renders panels that
// only consume AgentWorkbench.
export type ChatWorkbench = {
  connected: boolean
  reconnecting: boolean
  error: string | null
  messages: AgentMessage[]
  /** Whether this conversation is the one on screen (its pane is visible). */
  active: boolean
  /** The tab is a new conversation that has not been stored yet. */
  fresh: boolean
  busy: boolean
  serverRunning: boolean
  statusEvent?: { event: string; state?: string; at: number } | null
  /** Delegated subagents currently running, for the live progress line. */
  taskProgress?: TaskProgress[]
  hasMoreHistory: boolean
  /** How many stored segments are still unloaded (sizes the transcript spacer). */
  unloadedSegments: number
  loadingOlder: boolean
  loadOlder: () => void
  send: (content: string, mode?: AgentMode, media?: ChatMediaItem[]) => void
  sendCommand: (command: string) => void
  stop: () => void
  todos: TodoItem[]
  pendingQuestion: PendingQuestion | null
  pendingApproval: PendingApproval | null
  contextUsage: ContextUsage | null
  answerQuestion: (answers: string[]) => void
  answerApproval: (decision: PermissionDecision) => void
  agentMode: AgentMode
  onModeChange: (mode: AgentMode) => void
}

const ChatWorkbenchCtx = createContext<ChatWorkbench | null>(null)

export function ChatWorkbenchProvider({ value, children }: { value: ChatWorkbench; children: ReactNode }) {
  return <ChatWorkbenchCtx.Provider value={value}>{children}</ChatWorkbenchCtx.Provider>
}

export function useChatWorkbench(): ChatWorkbench {
  const value = useContext(ChatWorkbenchCtx)
  if (!value) {
    throw new Error('useChatWorkbench must be used inside ChatWorkbenchProvider')
  }
  return value
}