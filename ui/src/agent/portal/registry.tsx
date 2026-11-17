// The workbench's panels, resolved inside this module.
//
// The shell's registry merges its own panels with every plugin's manifest; that
// lives in the shell. Here the chat workbench owns all of its panels, so the map
// is the list: order comes from the manifest (pages/panels of this plugin), and
// an id it does not know is simply absent.

import type { WorkbenchPlugin } from '../workbench/types'

export type LocalPlugins = {
  plugins: WorkbenchPlugin[]
  /** Present for call-site parity with the shell's registry; this module has no remotes. */
  missing: string[]
}

export function usePlugins(modules: Record<string, WorkbenchPlugin>, order: string[]): LocalPlugins {
  const plugins: WorkbenchPlugin[] = []
  for (const id of order) {
    const plugin = modules[id]
    if (plugin) {
      plugins.push(plugin)
    }
  }
  return { plugins, missing: [] }
}

/** Kept for call-site parity: this module loads no remote manifests of its own. */
export function useRemoteManifests(): { manifests: unknown[]; loading: boolean; error: string | null } {
  return { manifests: [], loading: false, error: null }
}
