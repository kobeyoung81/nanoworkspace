// The panel this application contributes to the portal's workbench.
//
// It is the git browser: the repository state, the file tree, the staging area and
// the diff view. It reads the agent the shell is focused on from the host, and it
// reaches the same workspace API the file browser uses — through this module's own
// endpoints, never the shell's client.

import { GitBrowserPanel } from './components/git/GitBrowserPanel'
import { setHost } from './host'
import type { PanelContext } from './contract'

export function GitPanel({ ctx }: { ctx: PanelContext }) {
  // The shell installs its services for as long as the panel is mounted; the
  // components below read them instead of threading a context through each file.
  setHost(ctx)
  return <GitBrowserPanel />
}
