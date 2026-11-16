// The workbench's panel set: this module's own panels, plus the ones other
// plugins contribute.
//
// The chat screen hosts the workbench, so it cannot read the shell's registry —
// the shell resolves every remote manifest and hands the panels over in the page
// context. This is the one place that merges the two lists, kept as a pure
// function so the rule (built-ins first, in their declared order; contributed
// panels appended; ids never duplicated) is testable without a DOM.

import type { LucideIcon } from 'lucide-react'
import type { WorkbenchPlugin } from './types'
import type { WorkbenchPanelContribution } from '../../contract'

/**
 * extraPanels turns what the shell handed over into workbench plugins.
 *
 * A contributed panel keeps its id (so a layout stored before the move still
 * finds it) and renders with the panel context, exactly as it did in the shell.
 */
function extraPanels(contributed: WorkbenchPanelContribution[]): WorkbenchPlugin[] {
  return contributed.map((panel) => ({
    id: panel.id,
    // The contract types the icon as a component that takes a className; the
    // dock header only ever renders `<icon className>`.
    icon: panel.icon as unknown as LucideIcon,
    title: panel.title,
    defaultSlot: panel.defaultSlot,
    ctxAware: true,
    Component: panel.Component,
  }))
}

/** The plugin id this application publishes under (see public/plugin.json). */
const OWN_PLUGIN_ID = 'workspace'

/**
 * buildPanelSet merges the declared panels with the contributed ones.
 *
 * `order` is this module's manifest order; a contributed panel whose id already
 * exists here is ignored (one id, one owner — the shell's own rule), so a remote
 * cannot shadow the agents list or the composer. This application's own manifest
 * panels are ignored too: the workbench already renders them, and mounting the
 * manifest copy as well made it install its own panel context in the middle of a
 * render (the recursion that crashed the page).
 */
export function buildPanelSet(
  internal: Record<string, WorkbenchPlugin>,
  order: string[],
  contributed: WorkbenchPanelContribution[] | undefined,
): { order: string[]; modules: Record<string, WorkbenchPlugin> } {
  const modules: Record<string, WorkbenchPlugin> = {}
  const ids: string[] = []
  for (const id of order) {
    const plugin = internal[id]
    if (plugin) {
      modules[id] = plugin
      ids.push(id)
    }
  }
  for (const plugin of extraPanels(contributed ?? [])) {
    if (modules[plugin.id] || plugin.id.startsWith(`${OWN_PLUGIN_ID}.`)) {
      continue
    }
    modules[plugin.id] = plugin
    ids.push(plugin.id)
  }
  return { order: ids, modules }
}
