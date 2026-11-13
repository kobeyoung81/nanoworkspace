// The address of the standalone file viewer page.
//
// Opening a preview in a real browser tab is a navigation inside the portal, not
// a `blob:` URL: a blob inherits the portal's origin, so an HTML file opened that
// way would run its scripts with access to the portal's storage (and therefore
// the login token). The viewer route keeps HTML inside the same sandboxed frame
// the dialog uses, and gives every other kind a refreshable, copyable address.
import type { ViewerMode } from './fileViewer'

export const VIEWER_PATH = '/files/view'

// viewerHref builds the viewer address for one file. URLSearchParams handles the
// escaping, so paths with spaces, `#`, `&` or non-ASCII names survive intact.
export function viewerHref(agentId: string, path: string, mode: ViewerMode): string {
  const query = new URLSearchParams({ agent: agentId, path, mode })
  return `${VIEWER_PATH}?${query.toString()}`
}
