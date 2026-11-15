// One agent row in the sidebar. The grip starts the pointer drag; the row itself
// stays a normal button so clicking selects without a drag threshold.

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, FolderInput, GripVertical, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'
import type { Agent } from '../../lib/agentApi'
import type { AgentGroup } from '../../lib/agentGroups'

export function AgentListItem({
  agent,
  selected,
  dragging,
  attention,
  dropLine,
  groups,
  restartBusy,
  onSelect,
  onRestart,
  onEdit,
  onDelete,
  onMove,
  onGripPointerDown,
}: {
  agent: Agent
  selected: boolean
  dragging: boolean
  attention: ReactNode
  /** Insertion line for a dragged agent, on this row's top or bottom edge. */
  dropLine: 'before' | 'after' | null
  groups: AgentGroup[]
  restartBusy: boolean
  onSelect: () => void
  onRestart: () => void
  onEdit: () => void
  onDelete: () => void
  /** Empty string moves the agent out of every group. */
  onMove: (groupID: string) => void
  onGripPointerDown: (event: ReactPointerEvent) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className={cn('relative ml-3 flex items-center gap-0.5 rounded-md', selected && 'bg-primary/10', dragging && 'opacity-60')}
      data-agent-row={agent.id}
    >
      {dropLine === 'before' ? (
        <span
          className="pointer-events-none absolute inset-x-1 -top-0.5 z-10 h-0.5 rounded bg-primary"
          data-agent-drop-line="before"
        />
      ) : null}
      <button
        type="button"
        onPointerDown={onGripPointerDown}
        className="flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
        aria-label={t('agent.groups.moveTo')}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-md pl-1.5 pr-2.5 py-2 text-left transition-colors',
          selected ? 'text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Bot className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{agent.display_name || agent.id}</span>
        </span>
        {attention}
      </button>
      {dropLine === 'after' ? (
        <span
          className="pointer-events-none absolute inset-x-1 -bottom-0.5 z-10 h-0.5 rounded bg-primary"
          data-agent-drop-line="after"
        />
      ) : null}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={t('agent.agentActions', { name: agent.display_name || agent.id })}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('agent.actions')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-auto min-w-32">
          {agent.status === 'running' ? (
            <DropdownMenuItem disabled={restartBusy} onSelect={onRestart}>
              <RefreshCw className="h-4 w-4" />
              {t('common.restart')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="h-4 w-4" />
              {t('agent.groups.moveTo')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {groups.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  disabled={group.id === agent.group_id}
                  onSelect={() => onMove(group.id)}
                >
                  {group.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem disabled={!agent.group_id} onSelect={() => onMove('')}>
                {t('agent.groups.ungrouped')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="h-4 w-4" />
            {t('common.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
