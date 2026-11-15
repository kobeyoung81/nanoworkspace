// The files page, as the workspace module's page.
//
// It is the portal's `/files` screen, moved out of the shell: the agent picker
// comes from the portal's API, the browser itself is the shell's file panel handed
// over as a component, and the bytes travel through this module's own API. When
// the panel moves into this application too, only that one reference changes.

import { useState } from 'react'
import { ArrowLeft, FolderTree, RefreshCw } from 'lucide-react'
import type { PageContext } from './contract'
import type { AgentSummary } from './types'
import { useApi } from './useApi'
import { FilePanel } from './components/FilePanel'

/** The agent the URL asks for (`?agent=`), read once at mount. */
function agentFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get('agent')
}

export function FilesPage({ ctx }: { ctx: PageContext }) {
  const { t, ui, api, navigate, toast } = ctx
  const {
    PageHeader,
    Card,
    CardContent,
    Button,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Skeleton,
    EmptyState,
    Badge,
  } = ui

  const [selectedAgent, setSelectedAgent] = useState<string | null>(agentFromLocation)
  const agentsState = useApi<AgentSummary[]>(api, '/me/agents', api.bases.user)
  const agents = agentsState.data ?? []

  const selectAgent = (agentId: string | null) => {
    setSelectedAgent(agentId)
    navigate(agentId ? `/files?agent=${encodeURIComponent(agentId)}` : '/files')
  }

  return (
    <div className="flex flex-col gap-6" data-workspace-page="files">
      <PageHeader
        title={t('files.title')}
        subtitle={t('files.subtitleSelf')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(selectedAgent ? `/agent?agent=${encodeURIComponent(selectedAgent)}` : '/agent')
              }
            >
              <ArrowLeft className="h-4 w-4" />
              {t('files.backToAgent')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                agentsState.refetch()
                toast.success(t('files.refreshed'))
              }}
              disabled={!selectedAgent}
            >
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
          <Select
            value={selectedAgent ?? 'none'}
            onValueChange={(value) => selectAgent(value === 'none' ? null : value)}
          >
            <SelectTrigger className="sm:w-64">
              <SelectValue placeholder={t('files.pickAgent')} />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.display_name || agent.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedAgent ? <Badge variant="secondary">{selectedAgent}</Badge> : null}
        </CardContent>
      </Card>

      {agentsState.loading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : selectedAgent ? (
        <Card className="h-[calc(100vh-16rem)] min-h-96">
          <CardContent className="h-full p-0">
            <FilePanel ctx={ctx} key={selectedAgent} agentId={selectedAgent} allowUpload />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={FolderTree}
          title={t('files.selectAgentToBrowse')}
          description={t('files.selectAgentSelf')}
          className="py-16"
        />
      )}
    </div>
  )
}

// The shell borrows this one: a page elsewhere embeds the workspace's browser.
export { FilePanel } from './components/FilePanel'

export { FileViewerPage } from './pages/FileViewerPage'
