import { useCallback, useEffect, useState } from 'react'
import { Files, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { readAgentPath, writeAgentPath } from '../../lib/browsingPath'
import { currentUser } from '../../lib/clientState'
import { getHost } from '../../host'
import { fetchGitInfo, listGitDir } from '../../lib/gitApi'
import { Spinner } from '../../ui/spinner'
import { GitFilesTab } from './GitFilesTab'
import { GitTab } from './GitTab'
import { resolveGitBrowsingPath } from '../../lib/gitBrowserPath'
import { setGitBrowserTab, useGitBrowserTab } from '../../lib/gitBrowserState'

export function GitBrowserPanel() {
  // The shell focuses one agent at a time; a panel reads it from the host.
  const selectedAgent = getHost().agentId ?? null
  const tab = useGitBrowserTab()
  // The directory being browsed travels with the agent it was resolved for:
  // switching agents must never list one agent's directory through another
  // agent's id.
  const [browse, setBrowse] = useState<{ agent: string; path: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const path = browse && browse.agent === selectedAgent ? browse.path : ''
  const resolving = Boolean(selectedAgent) && browse?.agent !== selectedAgent
  // The account whose state this is can become known after the panel mounts (a
  // hard refresh resolves the session while the workbench is already up) and the
  // remembered paths live in that account's namespace, so resolving before it is
  // known would read no memory at all.
  const account = currentUser()

  // Open the directory this agent was last browsing, or its home: another
  // agent's path is never carried over, and a directory that no longer exists
  // falls back to the home rather than parking the panel on a missing-path
  // error.
  useEffect(() => {
    if (!selectedAgent) {
      return
    }
    let cancelled = false
    void resolveGitBrowsingPath({
      remembered: readAgentPath('gitBrowser', selectedAgent),
      readable: (candidate) => listGitDir(selectedAgent, candidate).then(() => true, () => false),
      agentHome: () => fetchGitInfo(selectedAgent).then((info) => (info.agent_home ? info.agent_home : null), () => null),
    }).then((next) => {
      if (cancelled) {
        return
      }
      setBrowse({ agent: selectedAgent, path: next })
      writeAgentPath('gitBrowser', selectedAgent, next)
    })
    return () => {
      cancelled = true
    }
  }, [selectedAgent, account])

  const onPathChange = useCallback(
    (next: string) => {
      if (!selectedAgent) {
        return
      }
      setBrowse({ agent: selectedAgent, path: next })
      writeAgentPath('gitBrowser', selectedAgent, next)
    },
    [selectedAgent],
  )

  const onMutated = () => setRefreshKey((k) => k + 1)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="min-h-0 flex-1">
        {resolving ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : tab === 'files' ? (
          <GitFilesTab agentId={selectedAgent} path={path} onPathChange={onPathChange} refreshKey={refreshKey} />
        ) : (
          <GitTab agentId={selectedAgent} path={path} onPathChange={onPathChange} onMutated={onMutated} />
        )}
      </div>
      <GitTabBar />
    </div>
  )
}

// GitTabBar is the Files/Git switcher, pinned to the bottom of the control.
function GitTabBar() {
  const { t } = useTranslation()
  const tab = useGitBrowserTab()
  const items = [
    { id: 'files' as const, icon: Files, label: t('gitBrowser.tabs.files') },
    { id: 'git' as const, icon: GitBranch, label: t('gitBrowser.tabs.git') },
  ]
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-t px-1.5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setGitBrowserTab(item.id)}
          className={cn(
            'flex h-7 flex-1 items-center justify-center gap-1 rounded px-2 text-xs font-medium transition-colors',
            tab === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <item.icon className="h-3.5 w-3.5" />
          {item.label}
        </button>
      ))}
    </div>
  )
}
