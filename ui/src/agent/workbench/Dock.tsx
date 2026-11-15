import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { GripVertical, PanelBottomClose, PanelLeftClose, PanelRightClose } from 'lucide-react'
import type { DockId, DockState, PluginDescriptor } from './types'
import { cn } from '../lib/utils'

const HIDE_ICON: Record<DockId, typeof PanelLeftClose | undefined> = {
  left: PanelLeftClose,
  right: PanelRightClose,
  bottom: PanelBottomClose,
  center: undefined,
}

type DockProps = {
  dock: DockId
  state: DockState
  plugins: PluginDescriptor[]
  className?: string
  // Headerless mode for the mobile drawer, which draws its own title bar.
  hideHeader?: boolean
  // Whether name tags can be dragged to re-dock. False on the mobile layout,
  // where docking is disabled.
  draggable?: boolean
  onActivate: (panelId: string) => void
  // Starts a pointer-based panel drag from the grip (whoever owns the pointer
  // listeners drives the drop). Called only when `draggable` is true.
  onGripPointerDown: (panelId: string, e: ReactPointerEvent) => void
  // Insertion caret x-offset (relative to the strip) while a tab is being
  // dragged over this dock's header; null when not a drop candidate.
  caretX?: number | null
  // Hides the whole dock (left/right/bottom only).
  onHideDock?: () => void
  hostFor: (panelId: string) => HTMLDivElement
  emptyState?: ReactNode
}

function pluginOf(plugins: PluginDescriptor[], id: string): PluginDescriptor | undefined {
  return plugins.find((p) => p.id === id)
}

// HostBox moves a stable per-plugin DOM node (into which the plugin is
// portaled) into this box. Relocating a plugin between docks simply re-parents
// the node, so the plugin component never unmounts and WS/editor/terminal
// state survives.
export function HostBox({ host, className }: { host?: HTMLDivElement; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !host) {
      return
    }
    node.appendChild(host)
    return () => {
      host.remove()
    }
  }, [host])
  return <div ref={ref} className={cn('h-full min-h-0 w-full', className)} />
}

export function Dock({ dock, state, plugins, className, hideHeader, draggable = true, onActivate, onGripPointerDown, caretX, onHideDock, hostFor, emptyState }: DockProps) {
  const HideIcon = HIDE_ICON[dock]

  const activePlugin = state.active ? pluginOf(plugins, state.active) : undefined

  // The dock header merges every plugin's header into one row: name tags
  // (grip-only drag, label click activates) on the left; the active plugin's
  // optional tabs + icon actions; then the dock's always-visible hide control.
  const header = state.tabs.length > 0 && !hideHeader ? (
    <header
      data-tab-strip
      data-dock={dock}
      className="relative flex h-9 shrink-0 items-center gap-1 border-b px-1.5"
    >
      <div className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {state.tabs.map((panelId, index) => {
          const plugin = pluginOf(plugins, panelId)
          if (!plugin) {
            return null
          }
          const Icon = plugin.icon
          const active = panelId === state.active
          return (
            <div
              key={panelId}
              data-tab-index={index}
              className={cn(
                'flex h-7 shrink-0 items-center gap-0.5 border-b-2 transition-colors',
                active ? 'border-primary' : 'border-transparent',
              )}
            >
              <button
                type="button"
                onPointerDown={draggable ? (e) => onGripPointerDown(panelId, e) : undefined}
                className={cn(
                  'flex h-6 w-5 shrink-0 touch-none items-center justify-center rounded text-muted-foreground transition-colors',
                  draggable ? 'cursor-grab hover:bg-accent hover:text-foreground active:cursor-grabbing' : 'cursor-default opacity-50',
                )}
                aria-label={`move ${plugin.title}`}
                title={`Move ${plugin.title}`}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onActivate(panelId)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-28 truncate">{plugin.title}</span>
              </button>
            </div>
          )
        })}
        {activePlugin?.HeaderTabs ? <div className="mx-1 flex h-7 shrink-0 items-center gap-0.5 px-0.5"><activePlugin.HeaderTabs /></div> : null}
        {caretX != null ? (
          <div
            className="pointer-events-none absolute top-1 bottom-1 z-10 w-0.5 rounded bg-primary shadow-[0_0_4px_rgba(22,93,252,.7)]"
            style={{ left: caretX }}
          />
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
        {activePlugin?.HeaderActions ? <activePlugin.HeaderActions /> : null}
        {activePlugin?.HeaderActions && HideIcon && onHideDock ? <span className="mx-0.5 h-5 w-px shrink-0 bg-border" /> : null}
        {HideIcon && onHideDock ? (
          <button
            type="button"
            onClick={onHideDock}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:opacity-100"
            aria-label="Hide dock"
            title="Hide dock"
          >
            <HideIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </header>
  ) : null

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      {header}
      <div className="relative min-h-0 flex-1">
        {state.tabs.length === 0 ? (
          emptyState ?? <DropHint />
        ) : state.active ? (
          <HostBox host={hostFor(state.active)} />
        ) : null}
      </div>
    </div>
  )
}

// DropHint is the default empty-dock affordance ("drop a plugin here").
export function DropHint() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 px-6 py-6 text-muted-foreground">
        <span className="text-xs font-medium">Drop a panel here</span>
      </div>
    </div>
  )
}