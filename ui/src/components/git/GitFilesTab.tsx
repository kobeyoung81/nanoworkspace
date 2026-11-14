import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ChevronDown, FolderInput, FolderTree, RefreshCw, Star, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../lib/toast'
import {
  addShortcut,
  deleteShortcut,
  fetchGitInfo,
  fetchGitStatus,
  fetchRepos,
  fetchShortcuts,
  suggestPaths,
  type GitFileEntry,
  type GitHomeInfo,
  type GitRepoSummary,
  type GitShortcut,
} from '../../lib/gitApi'
import { rebaseChanges } from '../../lib/gitStatus'
import { readRawState, writeRawState } from '../../lib/clientState'
import { Button } from '../../ui/button'
import { EmptyState } from '../../ui/empty-state'
import { Input } from '../../ui/input'
import { Skeleton } from '../../ui/skeleton'
import { cn } from '../../lib/utils'
import { FileTree } from './FileTree'
import { BlobViewer } from './BlobViewer'
import { agentHomeLabel, shouldAutoStarAgentHome, starredPaths } from '../../lib/gitBrowserPath'

export type GitFilesTabProps = {
  agentId: string | null
  path: string
  onPathChange: (path: string) => void
  refreshKey: number
}

// autoStarField is the per-agent marker that the agent's home has been starred
// by default. The marker is what keeps a deliberate unstar from being undone by
// the next load.
function autoStarField(agentId: string): string {
  return `autoStar.${agentId}`
}

// ensureAgentHomeStar stars the agent's home by default, once, and returns the
// favourites to render. Favouriting is a convenience, so a failing shortcut
// service leaves the list untouched rather than failing the panel.
async function ensureAgentHomeStar(agentId: string, home: string, stored: GitShortcut[]): Promise<GitShortcut[]> {
  const handled = readRawState('gitBrowser', autoStarField(agentId)) === '1'
  if (!shouldAutoStarAgentHome({ home, shortcuts: stored, alreadyHandled: handled })) {
    if (home !== '' && stored.some((shortcut) => shortcut.path === home)) {
      writeRawState('gitBrowser', autoStarField(agentId), '1')
    }
    return stored
  }
  try {
    await addShortcut(agentId, home, agentHomeLabel(home))
  } catch {
    return stored
  }
  writeRawState('gitBrowser', autoStarField(agentId), '1')
  try {
    return await fetchShortcuts(agentId)
  } catch {
    return stored
  }
}

export function GitFilesTab({ agentId, path, onPathChange, refreshKey }: GitFilesTabProps) {
  const { t } = useTranslation()
  const [info, setInfo] = useState<GitHomeInfo | null>(null)
  const [repos, setRepos] = useState<GitRepoSummary[]>([])
  const [shortcuts, setShortcuts] = useState<GitShortcut[]>([])
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [viewer, setViewer] = useState<{ path: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Bumped by every reload that should also rebuild the directories already
  // expanded in the tree, which is how files added or removed elsewhere appear.
  const [version, setVersion] = useState(0)

  const refreshAll = useCallback(async () => {
    if (!agentId) {
      return
    }
    try {
      const [home, stored] = await Promise.all([fetchGitInfo(agentId), fetchShortcuts(agentId)])
      setInfo(home)
      // The agent's home is a default favourite: it is where the browser opens,
      // and one click gets back there. It is added once per agent, so a user who
      // unstars it is not fought by the next load (see ensureAgentHomeStar).
      const tips = await ensureAgentHomeStar(agentId, home.agent_home, stored)
      setShortcuts(tips)
      setStarred(starredPaths(agentId, tips))
      // Change markers come from every repository at or under the current path,
      // which is what lets the tree flag a directory several levels above the
      // changed file. A hypervisor without /repos (404/501) falls back to the
      // single repository containing the path; a path outside version control
      // simply has no markers.
      try {
        setRepos(await fetchRepos(agentId, path))
      } catch {
        try {
          const status = await fetchGitStatus(agentId, path)
          setRepos(
            status.in_repo === false
              ? []
              : [
                  {
                    ...status,
                    rel_path: status.repo_root,
                    name: status.repo_root.split('/').pop() || status.repo_root,
                  },
                ],
          )
        } catch {
          setRepos([])
        }
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [agentId, path])

  // A reload that also tells the tree to re-read its expanded directories.
  const reloadTree = useCallback(async () => {
    await refreshAll()
    setVersion((v) => v + 1)
  }, [refreshAll])

  useEffect(() => {
    // The initial load is deliberately triggered from an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAll()
  }, [refreshAll, refreshKey])

  // The tree has no push channel, so anything written elsewhere (a build, a
  // pull, an agent editing files) is only visible after a reload. Refresh every
  // 15s while the page is visible and the current directory actually holds a
  // repository; an empty directory has nothing to poll.
  const hasRepos = repos.length > 0
  useEffect(() => {
    if (!agentId || !hasRepos) {
      return
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void reloadTree()
      }
    }, 15_000)
    return () => window.clearInterval(id)
  }, [agentId, hasRepos, reloadTree])

  // Git reports paths relative to each repository root while the tree is rooted
  // at the data root, so every repository's changes are rebased onto the tree
  // here; without this no row would ever match a change unless the data root
  // were itself the repository.
  const treeStatuses = useMemo(() => rebaseChanges(repos, info?.data_root), [repos, info?.data_root])

  const handleOpen = useCallback(
    (entry: GitFileEntry, relPath: string) => {
      if (entry.is_dir) {
        onPathChange(relPath)
        return
      }
      setViewer({ path: relPath, name: entry.name })
    },
    [onPathChange],
  )

  const handleToggleStar = useCallback(
    async (relPath: string, isDir: boolean, name: string) => {
      if (!agentId) {
        return
      }
      const existing = shortcuts.find((s) => s.path === relPath)
      if (existing) {
        await deleteShortcut(existing.id)
        setShortcuts((prev) => prev.filter((s) => s.id !== existing.id))
        setStarred((prev) => {
          const next = new Set(prev)
          next.delete(relPath)
          return next
        })
        toast(t('gitBrowser.tree.unstarred', { name }))
        return
      }
      try {
        const label = isDir ? name : name.split('.').pop()?.toUpperCase()
        await addShortcut(agentId, relPath, label)
        const tips = await fetchShortcuts(agentId)
        setShortcuts(tips)
        setStarred(starredPaths(agentId, tips))
        toast.success(t('gitBrowser.tree.starred', { name }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.na'))
      }
    },
    [agentId, shortcuts, t],
  )

  const handleRootStar = useCallback(() => {
    if (!agentId || path === '') {
      return
    }
    const name = path.split('/').filter(Boolean).pop() ?? path
    void handleToggleStar(path, true, name)
  }, [agentId, path, handleToggleStar])

  const handleRemoveShortcut = useCallback(
    async (id: number) => {
      await deleteShortcut(id)
      const tips = await (agentId ? fetchShortcuts(agentId) : Promise.resolve([]))
      setShortcuts(tips)
      setStarred(agentId ? starredPaths(agentId, tips) : new Set<string>())
    },
    [agentId],
  )

  if (!agentId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState icon={FolderTree} title={t('files.noAgentTitle')} description={t('files.selectAgent')} className="w-full" />
      </div>
    )
  }

  // The tree root follows the current directory (empty = data root). The header
  // and the path picker spell out the whole path; the tree row itself shows only
  // the folder name.
  const rootPathLabel = path || info?.data_root || t('gitBrowser.tree.userHome')
  const rootName = rootPathLabel.split('/').filter(Boolean).pop() ?? rootPathLabel

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground" title={rootPathLabel}>
          {t('gitBrowser.tree.root', { root: rootPathLabel })}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <RootDirectoryMenu
            agentId={agentId}
            shortcuts={shortcuts}
            agentHome={info?.agent_home ?? ''}
            onSelect={onPathChange}
            onRemove={handleRemoveShortcut}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleRootStar}
            disabled={path === ''}
            aria-label={starred.has(path) ? t('gitBrowser.root.unstar') : t('gitBrowser.root.star')}
            title={starred.has(path) ? t('gitBrowser.root.unstar') : t('gitBrowser.root.star')}
          >
            <Star className={cn('h-3.5 w-3.5', starred.has(path) && 'fill-primary text-primary')} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={reloadTree} aria-label={t('common.refresh')}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : loading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      ) : (
        <FileTree
          agentId={agentId}
          rootPath={path}
          rootLabel={rootName}
          statuses={treeStatuses}
          starred={starred}
          version={version}
          onOpen={handleOpen}
          onToggleStar={handleToggleStar}
        />
      )}

      {viewer ? (
        <BlobViewer
          agentId={agentId}
          path={viewer.path}
          name={viewer.name}
          open
          onOpenChange={() => setViewer(null)}
          onChanged={() => reloadTree()}
        />
      ) : null}
    </div>
  )
}
// RootDirectoryMenu is the far-right dropdown on the Root Directory row:
// fixed entries for the two roots every agent has (the data root, the agent's
// home), then path suggestions for the typed query (heuristic search), then the
// saved shortcut paths. Selecting any entry switches the root.
function RootDirectoryMenu({
  agentId,
  shortcuts,
  agentHome,
  onSelect,
  onRemove,
}: {
  agentId: string
  shortcuts: GitShortcut[]
  agentHome: string
  onSelect: (path: string) => void
  onRemove: (id: number) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef(0)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDown = (e: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    window.clearTimeout(debounceRef.current)
    const q = query.trim()
    debounceRef.current = window.setTimeout(() => {
      if (!q) {
        setMatches([])
        return
      }
      suggestPaths(agentId, q, 20)
        .then(setMatches)
        .catch(() => setMatches([]))
    }, 200)
    return () => window.clearTimeout(debounceRef.current)
  }, [agentId, query])

  const choose = (path: string) => {
    onSelect(path)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('gitBrowser.root.open')}
        title={t('gitBrowser.root.open')}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-7 z-30 w-72 overflow-hidden rounded-md border bg-popover p-1 shadow-md">
          {/* The two directories every agent has, always one click away: the
              browser opens at the agent's home now, and the data root (the
              container's own home) is where its favourites and other agents'
              folders live. */}
          <button
            type="button"
            className="flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
            title={t('gitBrowser.path.userHomeHint')}
            onMouseDown={(e) => {
              e.preventDefault()
              choose('')
            }}
          >
            <FolderTree className="h-3.5 w-3.5 shrink-0 text-info" />
            <span className="truncate">{t('gitBrowser.path.userHome')}</span>
          </button>
          {agentHome ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
              title={t('gitBrowser.path.agentHomeHint')}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(agentHome)
              }}
            >
              <FolderInput className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">{t('gitBrowser.path.agentHome')}</span>
            </button>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <Input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder={t('gitBrowser.root.searchPlaceholder')}
            className="h-7 text-xs"
            spellCheck={false}
            autoFocus
          />
          <div className="mt-1 max-h-64 overflow-auto">
            {query.trim() && matches.length > 0 ? (
              <>
                <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  {t('gitBrowser.root.suggestions')}
                </p>
                {matches.map((match) => (
                  <button
                    key={match}
                    type="button"
                    className="flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(match)
                    }}
                  >
                    <FolderInput className="h-3.5 w-3.5 shrink-0 text-info" />
                    <span className="truncate">{match}</span>
                  </button>
                ))}
              </>
            ) : null}
            <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
              {t('gitBrowser.root.shortcuts')}
            </p>
            {shortcuts.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">{t('gitBrowser.root.noShortcuts')}</p>
            ) : (
              shortcuts.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent">
                  <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-xs"
                    title={shortcut.path}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(shortcut.path)
                    }}
                  >
                    {shortcut.label || shortcut.path || t('gitBrowser.tree.userHome')}
                  </button>
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded hover:bg-background"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onRemove(shortcut.id)
                    }}
                    aria-label={t('common.remove')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
