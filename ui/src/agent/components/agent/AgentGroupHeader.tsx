// The header of one agent group: a collapsible row that doubles as the pointer
// drag handle for reordering the groups themselves. The ungrouped bucket renders
// through the same component but without a menu or a handle — it is a place, not
// a group the user created.
//
// The drag follows the workbench's own pointer pattern (no drag library): the
// handle starts a drag, the parent tracks the pointer and resolves the target.

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FolderPlus, GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'
import { isRealGroup, type AgentBucket } from '../../lib/agentGrouping'
import { AttentionDots } from './AttentionDots'

export function AgentGroupHeader({
  bucket,
  collapsed,
  attention,
  dragging,
  onToggle,
  onRename,
  onDelete,
  onNewAgent,
  onGripPointerDown,
}: {
  bucket: AgentBucket
  collapsed: boolean
  attention: { running: boolean; awaiting: boolean; unread: boolean }
  dragging: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
  onNewAgent: () => void
  onGripPointerDown: (event: ReactPointerEvent) => void
}) {
  const { t } = useTranslation()
  const real = isRealGroup(bucket)
  const name = real ? bucket.name : t('agent.groups.ungrouped')

  return (
    <div
      className={cn('group/header flex items-center gap-0.5 rounded-md px-1 py-1', dragging && 'opacity-60')}
      data-agent-group={bucket.id}
      data-agent-group-header={bucket.id}
    >
      {real ? (
        <button
          type="button"
          onPointerDown={onGripPointerDown}
          className="flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          aria-label={t('agent.groups.reorder')}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 py-0.5 text-left text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate text-xs font-medium">{name}</span>
        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
          {bucket.agents.length}
        </Badge>
        <AttentionDots
          running={attention.running}
          awaiting={attention.awaiting}
          unread={attention.unread}
        />
      </button>

      {real ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  // Hidden until the row is hovered — but a phone has no hover, so
                  // the menu has to stand up on its own there (and when it is
                  // reached with the keyboard).
                  className="h-6 w-6 shrink-0 opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 data-[state=open]:opacity-100"
                  aria-label={t('agent.groups.actions', { name })}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('agent.groups.actions', { name })}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-auto min-w-36">
            <DropdownMenuItem onSelect={onNewAgent}>
              <FolderPlus className="h-4 w-4" />
              {t('agent.groups.newAgentInGroup')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil className="h-4 w-4" />
              {t('agent.groups.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4" />
              {t('agent.groups.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
