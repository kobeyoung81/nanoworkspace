// The file browser this module already ships, mounted inside the chat workbench.
//
// It is the same component the /files page and the borrowed slot use; only the
// services differ, and those come from the host the shell installed.

import { FilePanel as Browser } from '../../../components/FilePanel'
import { getHost } from '../../../host'
import type { PageContext } from '../../../contract'

export function FilePanel({ agentId, allowUpload }: { agentId: string | null; allowUpload?: boolean }) {
  return <Browser ctx={getHost() as unknown as PageContext} agentId={agentId} allowUpload={allowUpload} />
}
