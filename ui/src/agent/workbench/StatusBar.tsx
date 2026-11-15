import type { ComponentType } from 'react'
import type { DockId, PluginDescriptor, WorkbenchLayout } from './types'
import { cn } from '../lib/utils'

type SectionDef = {
  dock: DockId
  sizePct: number
  visible: boolean
  hasTabs: boolean
}

// StatusBar is the thin footer strip (three logical, borderless parts). Each
// section tracks its dock's width so the parts slide along with dock resizing:
// left shows left-dock plugin status, center shows center+bottom, right shows
// right-dock plugin status. The activity-bar gutter keeps sections aligned
// with the docks above.
export function StatusBar({ layout, descriptors }: { layout: WorkbenchLayout; descriptors: PluginDescriptor[] }) {
  const left: SectionDef = { dock: 'left', sizePct: layout.sizes.leftPct, visible: !layout.hiddenSlots.left, hasTabs: layout.docks.left.tabs.length > 0 }
  const right: SectionDef = { dock: 'right', sizePct: layout.sizes.rightPct, visible: !layout.hiddenSlots.right, hasTabs: layout.docks.right.tabs.length > 0 }
  const center: SectionDef = { dock: 'center', sizePct: 0, visible: true, hasTabs: layout.docks.center.tabs.length > 0 }
  const bottom: SectionDef = { dock: 'bottom', sizePct: 0, visible: !layout.hiddenSlots.bottom, hasTabs: layout.docks.bottom.tabs.length > 0 }

  // Collect the status components for a set of docks (the active plugin of
  // each, if it contributes one).
  const statuses = (defs: SectionDef[]): ComponentType[] => {
    const out: ComponentType[] = []
    for (const def of defs) {
      if (!def.visible || !def.hasTabs) {
        continue
      }
      const activeId = layout.docks[def.dock].active
      const active = descriptors.find((p) => p.id === activeId)
      if (active?.StatusBar) {
        out.push(active.StatusBar)
      }
    }
    return out
  }

  const renderStatuses = (defs: SectionDef[]) => {
    const Components = statuses(defs)
    return Components.map((C, i) => <C key={i} />)
  }

  // Global right-aligned contributions (e.g. context usage), independent of dock widths.
  const rightGlobals = descriptors.map((d) => d.StatusBarRight).filter(Boolean) as ComponentType[]

  return (
    <footer className="flex h-6 shrink-0 border-t bg-card/40 text-[11px] text-muted-foreground">
      <div className="w-12 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 items-stretch">
        <div
          className={cn('flex h-full min-w-0 items-center gap-3 overflow-hidden px-3', !(left.visible && left.hasTabs) && 'hidden')}
          style={{ width: `${left.sizePct}%` }}
        >
          {renderStatuses([left])}
        </div>
        <div className="flex h-full min-w-0 flex-1 items-center gap-3 overflow-hidden px-3">
          <div className="flex h-full min-w-0 flex-1 items-center gap-3 overflow-hidden">
            {renderStatuses([center, bottom])}
          </div>
          {rightGlobals.length > 0 ? (
            <div className="flex shrink-0 items-center gap-3">
              {rightGlobals.map((C, i) => (
                <C key={i} />
              ))}
            </div>
          ) : null}
        </div>
        <div
          className={cn('flex h-full min-w-0 items-center gap-3 overflow-hidden px-3', !(right.visible && right.hasTabs) && 'hidden')}
          style={{ width: `${right.sizePct}%` }}
        >
          {renderStatuses([right])}
        </div>
      </div>
    </footer>
  )
}