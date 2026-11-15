// One group in the sidebar: a header plus the agents that belong to it. The
// whole section is the drop area for agents; the header's grip starts the drag
// that reorders groups. Both are pointer-driven (see hooks/usePointerDrag), the
// same mechanism the workbench uses for its docks.

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { Agent } from '../../lib/agentApi'
import type { AgentGroup } from '../../lib/agentGroups'
import type { AgentBucket } from '../../lib/agentGrouping'
import { useWorkbench } from '../../workbench/context'
import { agentAttention } from '../../conversations/attention'
import { AgentAttentionDots } from './AgentAttentionDots'
import { AgentGroupHeader } from './AgentGroupHeader'
import { AgentListItem } from './AgentListItem'

export function AgentGroupSection({
  bucket,
  collapsed,
  dropTarget,
  groupDropLine,
  agentDropLine,
  draggingID,
  groups,
  selectedAgent,
  restartBusyId,
  onToggle,
  onRename,
  onDelete,
  onNewAgent,
  onSelectAgent,
  onRestartAgent,
  onEditAgent,
  onDeleteAgent,
  onMoveAgent,
  onGripPointerDown,
}: {
  bucket: AgentBucket
  collapsed: boolean
  /** The pointer is currently over this section. */
  dropTarget: boolean
  /** Insertion line for a dragged group, on the section's top or bottom edge. */
  groupDropLine: 'before' | 'after' | null
  /** Insertion line for a dragged agent, on one row's top or bottom edge. */
  agentDropLine: { agentID: string; placement: 'before' | 'after' } | null
  /** Id of the item being dragged (a group id or an agent id). */
  draggingID: string | null
  groups: AgentGroup[]
  selectedAgent: string | null
  restartBusyId: string | null
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
  onNewAgent: () => void
  onSelectAgent: (agentId: string) => void
  onRestartAgent: (agentId: string) => void
  onEditAgent: (agent: Agent) => void
  onDeleteAgent: (agent: Agent) => void
  onMoveAgent: (agentId: string, groupID: string) => void
  onGripPointerDown: (kind: 'agent' | 'group', id: string, event: ReactPointerEvent) => void
}) {
  const { t } = useTranslation()
  const { attention } = useWorkbench()

  const groupAttention = bucket.agents.reduce(
    (acc, agent) => {
      const dots = agentAttention(attention, agent.id)
      return {
        running: acc.running || dots.running,
        awaiting: acc.awaiting || dots.awaiting,
        unread: acc.unread || dots.unread,
      }
    },
    { running: false, awaiting: false, unread: false },
  )

  return (
    <div
      className={cn('relative rounded-md transition-colors', dropTarget && 'bg-primary/5')}
      data-agent-group-section={bucket.id}
    >
      {groupDropLine === 'before' ? (
        <span
          className="pointer-events-none absolute inset-x-1 -top-0.5 z-10 h-0.5 rounded bg-primary"
          data-group-drop-line="before"
        />
      ) : null}
      <AgentGroupHeader
        bucket={bucket}
        collapsed={collapsed}
        attention={groupAttention}
        dragging={draggingID === bucket.id}
        onToggle={onToggle}
        onRename={onRename}
        onDelete={onDelete}
        onNewAgent={onNewAgent}
        onGripPointerDown={(event) => onGripPointerDown('group', bucket.id, event)}
      />
      {groupDropLine === 'after' ? (
        <span
          className="pointer-events-none absolute inset-x-1 -bottom-0.5 z-10 h-0.5 rounded bg-primary"
          data-group-drop-line="after"
        />
      ) : null}
      {collapsed ? null : (
        <div className="min-h-5" data-agent-group-body={bucket.id}>
          {bucket.agents.length === 0 ? (
            <p className="px-8 py-1.5 text-xs text-muted-foreground">{t('agent.groups.empty')}</p>
          ) : (
            bucket.agents.map((agent) => (
              <AgentListItem
                key={agent.id}
                agent={agent}
                selected={agent.id === selectedAgent}
                dragging={draggingID === agent.id}
                attention={<AgentAttentionDots agentId={agent.id} />}
                dropLine={
                  agentDropLine?.agentID === agent.id ? agentDropLine.placement : null
                }
                groups={groups}
                restartBusy={restartBusyId === agent.id}
                onSelect={() => onSelectAgent(agent.id)}
                onRestart={() => onRestartAgent(agent.id)}
                onEdit={() => onEditAgent(agent)}
                onDelete={() => onDeleteAgent(agent)}
                onMove={(groupID) => onMoveAgent(agent.id, groupID)}
                onGripPointerDown={(event) => onGripPointerDown('agent', agent.id, event)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
