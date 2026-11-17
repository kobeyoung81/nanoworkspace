import type { LucideIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { PanelContext } from '../portal/contract'

// A dock is a docking region (left / center / right / bottom). The workbench
// owns every dock's chrome (name tags, drag handles, hide control); plugins
// contribute content and, optionally, per-plugin header/status pieces.
export type DockId = 'left' | 'center' | 'right' | 'bottom'

export type DockState = {
  tabs: string[]
  active: string | null
}

export type WorkbenchLayout = {
  v: 1
  docks: Record<DockId, DockState>
  sizes: {
    leftPct: number
    rightPct: number
    bottomPct: number
  }
  lastSlot: Record<string, DockId>
  hiddenSlots: { left?: boolean; right?: boolean; bottom?: boolean }
}

export type PluginDescriptor = {
  id: string
  icon: LucideIcon
  title: string
  defaultSlot: DockId
  node: ReactNode
  // Chrome contributions, resolved from the manifest and rendered by the dock
  // header (active plugin only). Each receives no props and reads whatever it
  // needs from the workbench/chat contexts.
  HeaderActions?: ComponentType
  HeaderTabs?: ComponentType
  StatusBar?: ComponentType
  StatusBarRight?: ComponentType
  lazy?: ComponentType<{ panelId: string }>
}

// WorkbenchPlugin is the public plugin contract. A plugin is a self-describing
// body component with an i18n title key; it receives no props and pulls
// whatever it needs from the workbench/chat contexts. Header/status pieces are
// optional declarative contributions — the dock header and status bar render
// them, so plugins never paint their own chrome. Add a plugin by appending to
// the registry manifest + adding its i18n keys.
export type WorkbenchPlugin = {
  id: string
  icon: LucideIcon
  /** Shell i18n key; a plugin from another application carries `title` instead. */
  titleKey?: string
  /** Literal title, already localized (remote panels). */
  title?: string
  defaultSlot: DockId
  /**
   * Whether the component expects the panel context. A remote panel reads its
   * token, locale and theme from it instead of reaching into the shell.
   */
  ctxAware?: boolean
  Component: ComponentType<{ ctx?: PanelContext }>
  HeaderActions?: ComponentType
  HeaderTabs?: ComponentType
  StatusBar?: ComponentType
  // StatusBarRight is rendered in the fixed right edge of the footer (outside
  // the dock-width sections), e.g. global context-usage.
  StatusBarRight?: ComponentType
}