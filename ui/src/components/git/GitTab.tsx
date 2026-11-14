import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  Check,
  ChevronDown,
  CloudUpload,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  History,
  Plus,
  RefreshCw,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../lib/toast'
import {
  addRemote,
  cloneRepo,
  commitChanges,
  createTag,
  deleteTag,
  discardFiles,
  fetchCommitDetail,
  fetchDiff,
  fetchLog,
  fetchRemotes,
  fetchRepos,
  fetchRemote,
  fetchGitStatus,
  pullBranch,
  pushBranch,
  removeRemote,
  stageFiles,
  stashAction,
  unstageFiles,
  type GitChangeStatus,
  type GitCommitDetail,
  type GitLogPage,
  type GitRemote,
  type GitRepoSummary,
  type GitStash,
  type GitTag,
  changeMarker,
  decodeXY,
  statusTone,
  renameSourcePath,
} from '../../lib/gitApi'
import { readRawState, writeRawState } from '../../lib/clientState'
import { CHANGE_HEIGHT_MIN, DOCK_HEIGHT_MIN, changeHeightMax, dockHeightMax } from '../../lib/gitPanelHeights'
import { cn } from '../../lib/utils'
import { useAutoGrowTextarea } from '../../hooks/useAutoGrowTextarea'
import { useViewportHeight } from '../../hooks/useViewportHeight'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { ConfirmDialog } from '../../ui/confirm-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog'
import { EmptyState } from '../../ui/empty-state'
import { Input } from '../../ui/input'
import { Skeleton } from '../../ui/skeleton'
import { Spinner } from '../../ui/spinner'
import { Textarea } from '../../ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip'
import { DiffViewer } from './DiffViewer'
import { BranchMenu } from './BranchMenu'
import { GitBottomDock } from './GitBottomDock'
import { useStashList, useTagList } from '../../lib/gitDockData'
import { HeightResizeHandle } from '../../ui/resize-handle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu'

const toneText = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-destructive',
  untracked: 'text-muted-foreground',
  conflicted: 'text-destructive',
  renamed: 'text-info',
} as const

export type GitTabProps = {
  agentId: string | null
  path: string
  onPathChange: (path: string) => void
  onMutated: () => void
}

type SubView = 'changes' | 'remotes'

/** Client-state field holding the change-list height: "fit" or a pixel value. */
const CHANGE_HEIGHT_FIELD = 'changeHeight'
/** Stored when the change list sizes itself from its content. */
const CHANGE_HEIGHT_FIT = 'fit'
/** Drag start value used before the list has been measured on screen. */
const CHANGE_HEIGHT_FALLBACK = 220
/** The commit box grows from one line up to this height, then scrolls. */
const COMMIT_MAX_HEIGHT = 160

/** Default height for a docked panel: short enough to still read one row,
 *  never taller than its bound (see lib/gitPanelHeights). */
const DOCK_HEIGHT_DEFAULT = 240
/** Client-state field holding whether the commit button covers the whole tree. */
const COMMIT_ALL_FIELD = 'commitAll'

/** Exactly one of the bottom-docked panels is expanded at a time. */
type DockId = 'history' | 'tags' | 'stashes'

/** Client-state field holding which docked panel is expanded (empty = none). */
const OPEN_DOCK_FIELD = 'openDock'
/** Legacy boolean field, read once to migrate the history dock's open state. */
const HISTORY_OPEN_FIELD = 'historyExpanded'
/** Client-state fields holding each docked panel's height, in pixels. */
const DOCK_HEIGHT_FIELDS: Record<DockId, string> = {
  history: 'historyHeight',
  tags: 'tagsHeight',
  stashes: 'stashesHeight',
}

const DOCK_IDS: DockId[] = ['history', 'tags', 'stashes']

function isDockId(value: string): value is DockId {
  return (DOCK_IDS as string[]).includes(value)
}

/** Reads a docked panel's remembered height, clamped to the current viewport. */
function initialDockHeight(field: string, viewH: number): number {
  const stored = Number(readRawState('gitBrowser', field))
  if (!Number.isFinite(stored) || stored < DOCK_HEIGHT_MIN) {
    return DOCK_HEIGHT_DEFAULT
  }
  return Math.min(stored, dockHeightMax(viewH))
}

/** Height of a change list: "fit" (as tall as its content, capped) or a pixel
 *  value the user dragged the handle to. */
type ChangeHeight = number | typeof CHANGE_HEIGHT_FIT

/** Reads the remembered change-list height. A missing or stale entry means the
 *  list fits its content, which is the default. */
function initialChangeHeight(viewH: number): ChangeHeight {
  const stored = readRawState('gitBrowser', CHANGE_HEIGHT_FIELD)
  if (stored === CHANGE_HEIGHT_FIT) {
    return CHANGE_HEIGHT_FIT
  }
  const px = Number(stored)
  if (stored === null || !Number.isFinite(px) || px < CHANGE_HEIGHT_MIN) {
    return CHANGE_HEIGHT_FIT
  }
  return Math.min(px, changeHeightMax(viewH))
}

/** Total number of changed paths across every group of a repository. */
function changeCount(repo: GitRepoSummary): number {
  return repo.staged.length + repo.unstaged.length + repo.untracked.length + repo.conflicted.length
}

export function GitTab({ agentId, path, onPathChange, onMutated }: GitTabProps) {
  const { t } = useTranslation()
  // The resizable heights below are bounded by a fraction of the view, so the
  // panel has to re-render when the window changes size (rotation).
  const viewH = useViewportHeight()
  const [subView, setSubView] = useState<SubView>('changes')
  const [repos, setRepos] = useState<GitRepoSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ title: string; raw: string } | null>(null)
  const [poll, setPoll] = useState(0)
  const [cloneOpen, setCloneOpen] = useState(false)
  // activeRoot selects the repository the non-changes sub-views operate on.
  const [activeRoot, setActiveRoot] = useState<string | null>(null)
  // The change list fits its content until the user drags its handle, which is
  // remembered; a double click on the handle goes back to fitting.
  const [changeHeight, setChangeHeight] = useState<ChangeHeight>(() => initialChangeHeight(viewH))
  // The docks start collapsed except the one that was open last time, and each
  // remembers its own height; like the change-list height they survive a reload.
  const [openDock, setOpenDock] = useState<DockId | null>(() => {
    const stored = readRawState('gitBrowser', OPEN_DOCK_FIELD)
    if (stored !== null) {
      return isDockId(stored) ? stored : null
    }
    // Migration: earlier builds stored the history dock's state as a boolean.
    return readRawState('gitBrowser', HISTORY_OPEN_FIELD) === '1' ? 'history' : null
  })
  const [historyHeight, setHistoryHeight] = useState(() => initialDockHeight(DOCK_HEIGHT_FIELDS.history, viewH))
  const [tagsHeight, setTagsHeight] = useState(() => initialDockHeight(DOCK_HEIGHT_FIELDS.tags, viewH))
  const [stashesHeight, setStashesHeight] = useState(() => initialDockHeight(DOCK_HEIGHT_FIELDS.stashes, viewH))

  // refresh reloads every repository at or under the current directory. Older
  // hypervisors have no /repos endpoint, so a 404/501 falls back to the
  // single-repository status call and degrades to a one-entry list.
  const refresh = useCallback(async () => {
    if (!agentId) {
      return
    }
    try {
      let next: GitRepoSummary[]
      try {
        next = await fetchRepos(agentId, path)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!/(404|501|not implemented|not found)/i.test(message)) {
          throw err
        }
        const status = await fetchGitStatus(agentId, path)
        next =
          status.in_repo === false
            ? []
            : [{ ...status, rel_path: status.repo_root, name: status.repo_root.split('/').pop() || status.repo_root }]
      }
      setRepos(next)
      setError(null)
      setActiveRoot((current) =>
        current && next.some((repo) => repo.repo_root === current) ? current : (next[0]?.repo_root ?? null),
      )
    } catch (err) {
      setRepos([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoaded(true)
    }
  }, [agentId, path])

  useEffect(() => {
    // The panel loads on mount and on manual/auto refresh triggers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh, poll])

  // Auto-refresh every 15s while the panel shows at least one repository; a
  // directory holding no repository has nothing to poll and would only spam
  // failed requests.
  useEffect(() => {
    if (!agentId || repos.length === 0) {
      return
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setPoll((p) => p + 1)
      }
    }, 15_000)
    return () => window.clearInterval(id)
  }, [agentId, repos.length])

  // The docked panels print their entry count while collapsed, so their lists are
  // loaded eagerly and refreshed on the same poll counter the change list uses.
  // The repository is resolved here rather than from `activeRepo` below because
  // hooks have to run before the early returns.
  const dockRepoRoot = repos.some((repo) => repo.repo_root === activeRoot)
    ? activeRoot
    : (repos[0]?.repo_root ?? null)
  const tags = useTagList(agentId, dockRepoRoot, poll)
  const stashes = useStashList(agentId, dockRepoRoot, poll)

  const persistChangeHeight = useCallback((px: number) => {
    setChangeHeight(px)
    writeRawState('gitBrowser', CHANGE_HEIGHT_FIELD, String(px))
  }, [])

  const fitChangeHeight = useCallback(() => {
    setChangeHeight(CHANGE_HEIGHT_FIT)
    writeRawState('gitBrowser', CHANGE_HEIGHT_FIELD, CHANGE_HEIGHT_FIT)
  }, [])

  // Each dock remembers its own height so reopening it restores how it was left.
  const persistDockHeight = (dock: DockId, px: number) => {
    const setters: Record<DockId, (value: number) => void> = {
      history: setHistoryHeight,
      tags: setTagsHeight,
      stashes: setStashesHeight,
    }
    setters[dock](px)
    writeRawState('gitBrowser', DOCK_HEIGHT_FIELDS[dock], String(px))
  }

  // Opening a dock closes whichever one was open: only one expands at a time.
  const toggleDock = (dock: DockId, open: boolean) => {
    const next: DockId | null = open ? dock : null
    setOpenDock(next)
    writeRawState('gitBrowser', OPEN_DOCK_FIELD, next ?? '')
  }

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label)
      try {
        await fn()
        toast.success(t('gitBrowser.done', { label }))
        onMutated()
        setPoll((p) => p + 1)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.na'))
      } finally {
        setBusy(null)
      }
    },
    [onMutated, t],
  )

  const openDiff = useCallback(
    async (repoRoot: string, file: string, staged: boolean, ref?: string) => {
      if (!agentId) {
        return
      }
      setBusy('diff')
      try {
        const raw = await fetchDiff(agentId, repoRoot, file, staged, ref)
        const label = staged
          ? `${file} (${t('gitBrowser.changes.stagedIndex')})`
          : ref
            ? `${file} ↔ ${ref}`
            : `${file} (${t('gitBrowser.changes.worktree')})`
        setDiff({ title: label, raw })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.na'))
      } finally {
        setBusy((b) => (b === 'diff' ? null : b))
      }
    },
    [agentId, t],
  )

  const revealInTree = useCallback(
    (file: string) => {
      const dir = file.split('/').slice(0, -1).join('/')
      onPathChange(dir)
      onMutated()
    },
    [onMutated, onPathChange],
  )

  const copyPath = useCallback(
    (file: string) => {
      navigator.clipboard?.writeText(file).then(
        () => toast.success(t('gitBrowser.tree.copiedPath')),
        () => undefined,
      )
    },
    [t],
  )

  const viewTabs: { id: SubView; icon: typeof History; label: string }[] = [
    { id: 'changes', icon: RefreshCw, label: t('gitBrowser.git.changes') },
    { id: 'remotes', icon: CloudUpload, label: t('gitBrowser.git.remotes') },
  ]

  if (!agentId) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState icon={FolderGit2} title={t('files.noAgentTitle')} description={t('files.selectAgent')} className="w-full" />
      </div>
    )
  }

  const activeRepo = repos.find((repo) => repo.repo_root === activeRoot) ?? repos[0] ?? null
  const notARepo = loaded && repos.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
        {viewTabs.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => setSubView(view.id)}
            className={cn(
              'flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium',
              subView === view.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <view.icon className="h-3 w-3" />
            {view.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {/* Several repositories were found: pick the one the other sub-views
              and the docked history operate on. */}
          {repos.length > 1 ? (
            <select
              value={activeRepo?.repo_root ?? ''}
              onChange={(event) => setActiveRoot(event.target.value)}
              aria-label={t('gitBrowser.git.repositories')}
              title={t('gitBrowser.git.repositories')}
              className="h-6 max-w-44 rounded border bg-transparent px-1 text-[11px] text-muted-foreground"
            >
              {repos.map((repo) => (
                <option key={repo.repo_root} value={repo.repo_root}>
                  {repo.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={busy !== null}
            onClick={() => setPoll((p) => p + 1)}
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy === 'refresh' && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && !notARepo ? (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="outline" size="sm" className="h-6" onClick={refresh}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {notARepo ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            icon={FolderGit2}
            title={t('gitBrowser.git.notRepoTitle')}
            description={t('gitBrowser.git.notRepoDescription')}
            action={
              <Button variant="outline" size="sm" className="h-7" onClick={() => setCloneOpen(true)}>
                {t('gitBrowser.remotes.clone')}
              </Button>
            }
            className="w-full"
          />
        </div>
      ) : !loaded ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {subView === 'changes'
            ? repos.map((repo) => (
                <RepoSection
                  key={repo.repo_root}
                  agentId={agentId}
                  repo={repo}
                  active={repo.repo_root === activeRepo?.repo_root}
                  onFocus={() => setActiveRoot(repo.repo_root)}
                  busy={busy}
                  run={run}
                  openDiff={openDiff}
                  onReveal={revealInTree}
                  onCopyPath={copyPath}
                  changeHeight={changeHeight}
                  maxHeight={changeHeightMax(viewH)}
                  onChangeHeight={persistChangeHeight}
                  onFitHeight={fitChangeHeight}
                />
              ))
            : null}
          {subView === 'remotes' && activeRepo ? (
            <RemotesView agentId={agentId} repoRoot={activeRepo.repo_root} busy={busy} run={run} />
          ) : null}
        </div>
      )}

      {/* The docked panels stack along the bottom edge: history, tags, stashes.
          Each is collapsed by default (a single header strip) and expands by a
          click or an upward drag of that strip. Only one is open at a time, so
          the change list above never loses its height to two panels at once. */}
      {activeRepo ? (
        <div className="shrink-0">
          <GitBottomDock
            icon={History}
            title={t('gitBrowser.git.history')}
            repo={activeRepo}
            open={openDock === 'history'}
            height={historyHeight}
            min={DOCK_HEIGHT_MIN}
            max={dockHeightMax(viewH)}
            onOpenChange={(open) => toggleDock('history', open)}
            onHeightChange={(px) => persistDockHeight('history', px)}
            labels={{
              expand: t('gitBrowser.history.expand'),
              collapse: t('gitBrowser.history.collapse'),
              resize: t('gitBrowser.history.resizeHandle'),
            }}
          >
            <HistoryView
              agentId={agentId}
              repoRoot={activeRepo.repo_root}
              openDiff={(file, staged, ref) => openDiff(activeRepo.repo_root, file, staged, ref)}
            />
          </GitBottomDock>
          <GitBottomDock
            icon={Tag}
            title={t('gitBrowser.git.tags')}
            repo={activeRepo}
            count={tags.error ? null : tags.items.length}
            open={openDock === 'tags'}
            height={tagsHeight}
            min={DOCK_HEIGHT_MIN}
            max={dockHeightMax(viewH)}
            onOpenChange={(open) => toggleDock('tags', open)}
            onHeightChange={(px) => persistDockHeight('tags', px)}
            labels={{
              expand: t('gitBrowser.tags.expand'),
              collapse: t('gitBrowser.tags.collapse'),
              resize: t('gitBrowser.tags.resizeHandle'),
            }}
          >
            <TagPanel
              agentId={agentId}
              repoRoot={activeRepo.repo_root}
              tags={tags.items}
              error={tags.error}
              busy={busy}
              run={run}
            />
          </GitBottomDock>
          <GitBottomDock
            icon={GitCommitHorizontal}
            title={t('gitBrowser.git.stashes')}
            repo={activeRepo}
            count={stashes.error ? null : stashes.items.length}
            open={openDock === 'stashes'}
            height={stashesHeight}
            min={DOCK_HEIGHT_MIN}
            max={dockHeightMax(viewH)}
            onOpenChange={(open) => toggleDock('stashes', open)}
            onHeightChange={(px) => persistDockHeight('stashes', px)}
            labels={{
              expand: t('gitBrowser.stashes.expand'),
              collapse: t('gitBrowser.stashes.collapse'),
              resize: t('gitBrowser.stashes.resizeHandle'),
            }}
          >
            <StashPanel
              agentId={agentId}
              repoRoot={activeRepo.repo_root}
              stashes={stashes.items}
              error={stashes.error}
              busy={busy}
              run={run}
            />
          </GitBottomDock>
        </div>
      ) : null}

      {diff ? <DiffViewer title={diff.title} raw={diff.raw} open onOpenChange={() => setDiff(null)} /> : null}
      {cloneOpen ? (
        <CloneDialog
          agentId={agentId}
          onDone={() => {
            setCloneOpen(false)
            onMutated()
            setPoll((p) => p + 1)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * syncRepo fetches, then pulls when behind and pushes when ahead, mirroring the
 * old single-repository toolbar button for one repository.
 */
async function syncRepo(
  agentId: string,
  repo: GitRepoSummary,
  run: (label: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  await run('fetch', () => fetchRemote(agentId, repo.repo_root))
  if (repo.behind > 0) {
    await run('pull', () => pullBranch(agentId, repo.repo_root))
  }
  if (repo.ahead > 0) {
    await run('push', () => pushBranch(agentId, repo.repo_root))
  }
}

// ---- Repository section: header row + changes + commit box ----

/** RepoIconButton is the icon-only toolbar button used in a repository header. */
function RepoIconButton({
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: typeof GitPullRequest
  label: string
  hint?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-5 w-5" disabled={disabled} onClick={onClick} aria-label={label}>
          <Icon className="h-3 w-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint ?? label}</TooltipContent>
    </Tooltip>
  )
}

function RepoSection({
  agentId,
  repo,
  active,
  onFocus,
  busy,
  run,
  openDiff,
  onReveal,
  onCopyPath,
  changeHeight,
  maxHeight,
  onChangeHeight,
  onFitHeight,
}: {
  agentId: string
  repo: GitRepoSummary
  active: boolean
  onFocus: () => void
  busy: string | null
  run: (label: string, fn: () => Promise<void>) => Promise<void>
  openDiff: (repoRoot: string, file: string, staged: boolean, ref?: string) => void
  onReveal: (file: string) => void
  onCopyPath: (file: string) => void
  changeHeight: ChangeHeight
  maxHeight: number
  onChangeHeight: (px: number) => void
  onFitHeight: () => void
}) {
  const { t } = useTranslation()
  const total = changeCount(repo)

  return (
    <section className={cn('border-b last:border-b-0', active && 'bg-accent/20')}>
      <div className="flex h-7 items-center gap-1.5 px-2" onClick={onFocus}>
        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-semibold" title={repo.rel_path || repo.name}>
          {repo.name}
        </span>
        <BranchMenu agentId={agentId} repo={repo} busy={busy} run={run} />
        {repo.upstream && (repo.ahead > 0 || repo.behind > 0) ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {t('gitBrowser.git.aheadBehind', { ahead: repo.ahead, behind: repo.behind })}
          </span>
        ) : null}
        {repo.merge_in_progress ? <Badge variant="danger">{t('gitBrowser.git.merging')}</Badge> : null}
        {repo.rebase_in_progress ? <Badge variant="danger">{t('gitBrowser.git.rebasing')}</Badge> : null}
        {total > 0 ? <Badge className="bg-black/20 text-[10px]">{total}</Badge> : null}

        <span className="ml-auto flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
          <RepoIconButton
            icon={GitPullRequest}
            label={t('gitBrowser.git.sync')}
            hint={t('gitBrowser.git.syncHint')}
            disabled={busy !== null}
            onClick={() => run('sync', () => syncRepo(agentId, repo, run))}
          />
          <RepoIconButton
            icon={ArrowDownToLine}
            label={t('gitBrowser.git.pull')}
            disabled={busy !== null}
            onClick={() => run('pull', () => pullBranch(agentId, repo.repo_root))}
          />
          <RepoIconButton
            icon={ArrowUpFromLine}
            label={t('gitBrowser.git.push')}
            disabled={busy !== null}
            onClick={() => run('push', () => pushBranch(agentId, repo.repo_root))}
          />
        </span>
      </div>

      {/* The change list and the commit box only exist while there is something
          to commit; a clean repository keeps just a single status line. */}
      {total > 0 ? (
        <>
          <RepoChanges
            agentId={agentId}
            repo={repo}
            busy={busy}
            run={run}
            openDiff={(file, staged) => openDiff(repo.repo_root, file, staged)}
            onReveal={onReveal}
            onCopyPath={onCopyPath}
            height={changeHeight}
            maxHeight={maxHeight}
            onHeightChange={onChangeHeight}
            onFit={onFitHeight}
          />
          <CommitBox agentId={agentId} repo={repo} busy={busy} run={run} />
        </>
      ) : (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">{t('gitBrowser.changes.cleanTitle')}</p>
      )}
    </section>
  )
}

// ---- Per-repository change list (drag-resizable height) ----

function RepoChanges({
  agentId,
  repo,
  busy,
  run,
  openDiff,
  onReveal,
  onCopyPath,
  height,
  maxHeight,
  onHeightChange,
  onFit,
}: {
  agentId: string
  repo: GitRepoSummary
  busy: string | null
  run: (label: string, fn: () => Promise<void>) => Promise<void>
  openDiff: (file: string, staged: boolean) => void
  onReveal: (file: string) => void
  onCopyPath: (file: string) => void
  height: ChangeHeight
  /** Upper bound for the list, from the current viewport (see changeHeightMax). */
  maxHeight: number
  onHeightChange: (px: number) => void
  onFit: () => void
}) {
  const { t } = useTranslation()
  const [discardTarget, setDiscardTarget] = useState<{ files: string[]; label: string } | null>(null)
  const [measured, setMeasured] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const repoRoot = repo.repo_root
  const fitted = height === CHANGE_HEIGHT_FIT
  // While the list fits its content it has no stored height, so a drag has to
  // start from what is actually on screen; a resize (window, content) updates it.
  useEffect(() => {
    const el = listRef.current
    if (!el) {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect.height
      if (typeof box === 'number' && Number.isFinite(box) && box > 0) {
        setMeasured(box)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const currentHeight = fitted
    ? Math.min(measured ?? CHANGE_HEIGHT_FALLBACK, maxHeight)
    : Math.min(height, maxHeight)

  const groups: { key: 'staged' | 'unstaged' | 'untracked' | 'conflicted'; label: string; tone: string }[] = [
    { key: 'conflicted', label: t('gitBrowser.changes.conflicts'), tone: 'bg-destructive/20 text-destructive' },
    { key: 'staged', label: t('gitBrowser.changes.staged'), tone: 'bg-success/15 text-success' },
    { key: 'unstaged', label: t('gitBrowser.changes.modified'), tone: 'bg-warning/15 text-warning' },
    { key: 'untracked', label: t('gitBrowser.changes.untracked'), tone: 'bg-muted text-muted-foreground' },
  ]

  const fileActions = (file: string, staged: boolean) => {
    const items: { label: string; icon: typeof Check; onClick?: () => void; danger?: boolean; disabled?: boolean }[] = [
      {
        label: t('gitBrowser.changes.stage'),
        icon: Plus,
        disabled: busy !== null,
        onClick: () => run('stage', () => stageFiles(agentId, repoRoot, [file])),
      },
      {
        label: t('gitBrowser.changes.unstage'),
        icon: Ban,
        disabled: busy !== null || !staged,
        onClick: () => run('unstage', () => unstageFiles(agentId, repoRoot, [file])),
      },
      {
        label: t('gitBrowser.changes.discard'),
        icon: Trash2,
        danger: true,
        onClick: () => setDiscardTarget({ files: [file], label: file }),
      },
      {
        label: t('gitBrowser.changes.diff'),
        icon: GitCommitHorizontal,
        disabled: busy !== null,
        onClick: () => openDiff(file, staged),
      },
      { label: t('gitBrowser.changes.open'), icon: Check, disabled: busy !== null, onClick: () => onReveal(file) },
      { label: t('gitBrowser.changes.copyPath'), icon: Star, onClick: () => onCopyPath(file) },
    ]
    return items
  }

  const doDiscard = async () => {
    if (!discardTarget) {
      return
    }
    await run('discard', () => discardFiles(agentId, repoRoot, discardTarget.files))
    setDiscardTarget(null)
  }

  return (
    <>
      <div
        ref={listRef}
        className="overflow-y-auto px-2 pt-1"
        // Fitted: the list is exactly as tall as its content, capped at 60% of
        // the view. Dragged: the remembered pixel height.
        style={fitted ? { maxHeight } : { height: currentHeight }}
      >
        {groups.map((group) => {
          const changes = repo[group.key]
          if (!changes || changes.length === 0) {
            return null
          }
          return (
            <div key={group.key}>
              <div className="flex items-center gap-2 py-1">
                <span className="flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-bold text-foreground">
                  <Badge className={cn('bg-black/20 text-[10px]', group.tone)}>{changes.length}</Badge>
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</span>
                <span className="ml-auto flex items-center gap-1">
                  {group.key === 'staged' && repo.staged.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={busy !== null}
                      onClick={() => run('unstageAll', () => unstageFiles(agentId, repoRoot, []))}
                    >
                      {t('gitBrowser.changes.unstageAll')}
                    </Button>
                  ) : null}
                  {group.key === 'unstaged' && repo.unstaged.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={busy !== null}
                      onClick={() => run('stageAll', () => stageFiles(agentId, repoRoot, []))}
                    >
                      {t('gitBrowser.changes.stageAll')}
                    </Button>
                  ) : null}
                  {group.key === 'untracked' && repo.untracked.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={busy !== null}
                      onClick={() => run('stageAll', () => stageFiles(agentId, repoRoot, []))}
                    >
                      {t('gitBrowser.changes.stageAll')}
                    </Button>
                  ) : null}
                  {group.key === 'unstaged' && repo.unstaged.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-destructive"
                      disabled={busy !== null}
                      onClick={() => setDiscardTarget({ files: [], label: t('gitBrowser.changes.allChanges') })}
                    >
                      {t('gitBrowser.changes.discardAll')}
                    </Button>
                  ) : null}
                </span>
              </div>
              <div className="mb-2 rounded-md border">
                {changes.map((change, index) => {
                  const displayPath = renameSourcePath(change.path)
                  return (
                    <FileChangeRow
                      key={`${group.key}-${index}`}
                      change={change}
                      displayPath={displayPath}
                      actions={fileActions(displayPath, group.key === 'staged')}
                      onDoubleAction={() => openDiff(displayPath, group.key === 'staged')}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <HeightResizeHandle
        value={currentHeight}
        min={CHANGE_HEIGHT_MIN}
        max={maxHeight}
        expandBy="down"
        onChange={onHeightChange}
        onReset={onFit}
        label={t('gitBrowser.changes.resizeHandle')}
        hint={t('gitBrowser.changes.resizeHint')}
      />

      <ConfirmDialog
        open={discardTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setDiscardTarget(null)
          }
        }}
        title={t('gitBrowser.changes.discardTitle')}
        description={discardTarget ? t('gitBrowser.changes.discardDescription', { label: discardTarget.label }) : ''}
        confirmLabel={t('common.delete')}
        busy={busy === 'discard'}
        onConfirm={doDiscard}
      />
    </>
  )
}

// ---- Commit box: message and button share one row, the box grows downward ----

function CommitBox({
  agentId,
  repo,
  busy,
  run,
}: {
  agentId: string
  repo: GitRepoSummary
  busy: string | null
  run: (label: string, fn: () => Promise<void>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')
  // The button commits the whole working tree (the server stages everything with
  // `git add -A` first) unless the dropdown switches it to index-only, which is
  // how the old "Commit All" switch survives without a checkbox.
  const [commitAll, setCommitAll] = useState(() => readRawState('gitBrowser', COMMIT_ALL_FIELD) !== '0')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canCommit = commitAll ? changeCount(repo) > 0 : repo.staged.length > 0

  const chooseCommitAll = (next: boolean) => {
    setCommitAll(next)
    writeRawState('gitBrowser', COMMIT_ALL_FIELD, next ? '1' : '0')
  }

  // Grow the box from a single line up to the cap as the message is typed. The
  // hook also refuses to apply a measurement taken while the panel is hidden
  // behind the workbench's display:none vault — the git panel is mounted long
  // before it is shown, and a 0-height measurement there used to leave the box
  // as a sliver until the first keystroke.
  useAutoGrowTextarea(textareaRef, message, COMMIT_MAX_HEIGHT)

  const doCommit = async () => {
    if (!canCommit) {
      toast.error(commitAll ? t('gitBrowser.commit.noChanges') : t('gitBrowser.commit.nothingStaged'))
      return
    }
    await run('commit', () => commitChanges(agentId, repo.repo_root, message, { all: commitAll }))
    setMessage('')
  }

  return (
    <div className="flex items-start gap-1.5 border-t px-2 pb-2 pt-1.5">
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMessage(event.target.value)}
        placeholder={t('gitBrowser.commit.subject')}
        // The one-line minimum (text-xs line box 16px + py-1 8px + borders 2px)
        // is what keeps the field readable even if a measurement is ever
        // mistrusted again: min-h-0 would let it collapse to a sliver.
        className="min-h-[26px] flex-1 resize-none py-1 text-xs"
        data-commit-message=""
        rows={1}
      />
      <div className="flex shrink-0 items-center">
        <Button
          size="sm"
          className="h-7 rounded-r-none px-3 text-[11px]"
          disabled={busy !== null || !canCommit || !message.trim()}
          title={
            canCommit ? undefined : commitAll ? t('gitBrowser.commit.noChanges') : t('gitBrowser.commit.nothingStaged')
          }
          onClick={doCommit}
        >
          {busy === 'commit' ? <Spinner className="h-3 w-3" /> : null}
          {commitAll ? t('gitBrowser.commit.all') : t('gitBrowser.commit.commit')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-6 rounded-l-none"
              aria-label={t('gitBrowser.commit.mode')}
              title={t('gitBrowser.commit.mode')}
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem className="text-xs" onSelect={() => chooseCommitAll(false)}>
              {commitAll ? <span className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {t('gitBrowser.commit.commit')}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onSelect={() => chooseCommitAll(true)}>
              {commitAll ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
              {t('gitBrowser.commit.all')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function FileChangeRow({
  change,
  displayPath,
  actions,
  onDoubleAction,
}: {
  change: GitChangeStatus
  displayPath: string
  actions: { label: string; icon: typeof Plus; onClick?: () => void; danger?: boolean; disabled?: boolean }[]
  onDoubleAction: () => void
}) {
  const { t } = useTranslation()
  const tone = statusTone(change)
  const markers = decodeXY(change.xy)
  // "??" (untracked) yields no index or worktree code, so the row shows the
  // fallback badge the marker helper resolves for it.
  const fallback = changeMarker(change)
  return (
    <div
      className="group flex h-6 min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent/60"
      title={t('gitBrowser.changes.openDiffHint')}
      onDoubleClick={onDoubleAction}
    >
      <span className={cn('truncate', toneText[tone])}>{displayPath}</span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] font-semibold">
        {markers.index ? <span className={cn('rounded px-1', toneText[markers.index.tone])}>{markers.index.letter}</span> : null}
        {markers.worktree ? <span className={cn('rounded px-1', toneText[markers.worktree.tone])}>{markers.worktree.letter}</span> : null}
        {!markers.index && !markers.worktree ? (
          <span className={cn('rounded px-1', toneText[fallback.tone])}>{fallback.letter}</span>
        ) : null}
      </span>
      {/* The action cluster only shows on hover, so it may not outgrow the
          row's fixed height: the buttons stay at 16px (h-4), not 20px (h-5). */}
      <span
        className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
        onClick={(event) => event.stopPropagation()}
      >
        {actions.map((action) =>
          action.onClick ? (
            <Tooltip key={action.label}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={action.disabled}
                  onClick={action.onClick}
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded hover:bg-accent',
                    action.danger && 'text-destructive',
                    action.disabled && 'opacity-40',
                  )}
                  aria-label={action.label}
                >
                  <action.icon className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{action.label}</TooltipContent>
            </Tooltip>
          ) : null,
        )}
      </span>
    </div>
  )
}

// ---- History view ----

function HistoryView({
  agentId,
  repoRoot,
  openDiff,
}: {
  agentId: string
  repoRoot: string
  openDiff: (file: string, staged: boolean, ref?: string) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState<GitLogPage | null>(null)
  const [skip, setSkip] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)

  const load = useCallback(
    async (nextSkip: number) => {
      if (!agentId) {
        return
      }
      setLoading(true)
      try {
        const next = await fetchLog(agentId, repoRoot, 50, nextSkip)
        setPage((prev) => (prev && nextSkip > 0 ? { ...next, commits: [...prev.commits, ...next.commits] } : next))
        setSkip(nextSkip)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.na'))
      } finally {
        setLoading(false)
      }
    },
    [agentId, repoRoot, t],
  )

  useEffect(() => {
    // Reset the log view when the repo changes, then load the first page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(null)
    setSkip(0)
    setDetail(null)
    load(0)
  }, [load])

  const openDetail = useCallback(
    async (sha: string) => {
      if (!agentId) {
        return
      }
      try {
        const d = await fetchCommitDetail(agentId, repoRoot, sha)
        setDetail(d)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.na'))
      }
    },
    [agentId, repoRoot, t],
  )

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 space-y-0.5 overflow-auto pr-1">
          {loading && !page ? (
            <Skeleton className="h-8 w-full" />
          ) : page ? (
            page.commits.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                onClick={() => openDetail(commit.hash)}
                className={cn(
                  'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-accent/60',
                  detail?.hash === commit.hash && 'bg-accent',
                )}
              >
                <GitCommitHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{commit.subject}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {commit.author_name} · {new Date(commit.timestamp).toLocaleString()} · {commit.hash.slice(0, 7)}
                    {commit.refs?.length ? <span className="ml-1 text-info">{commit.refs.join(' ')}</span> : null}
                  </span>
                </span>
                {commit.refs && commit.refs.length ? <Badge variant="secondary" className="h-4 px-1 text-[9px]">{commit.refs[0]}</Badge> : null}
              </button>
            ))
          ) : null}
          {page?.has_more ? (
            <button
              type="button"
              onClick={() => load(skip + 50)}
              disabled={loading}
              className="flex w-full items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              {t('gitBrowser.history.loadMore')}
            </button>
          ) : null}
        </div>
        {detail ? (
          <div className="h-full w-72 shrink-0 overflow-auto border-l pl-3">
            <div className="flex items-center gap-2 pb-2">
              <h3 className="truncate text-xs font-semibold">{detail.subject}</h3>
              <button type="button" className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent" onClick={() => setDetail(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="break-words text-[11px] text-muted-foreground">{detail.message}</p>
            <div className="mt-3 space-y-0.5">
              {detail.files.length === 0 ? <p className="text-[11px] text-muted-foreground">{t('gitBrowser.commit.noFiles')}</p> : null}
              {detail.files.map((file, index) => (
                <div key={`${file.path}-${index}`} className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/60">
                  <span className="w-4 shrink-0 font-bold">{file.status}</span>
                  <span className="truncate">{file.path}</span>
                  <button
                    type="button"
                    className="ml-auto flex h-4 w-4 items-center justify-center rounded hover:bg-accent"
                    onClick={() => openDiff(file.path, false, detail.hash)}
                    title={t('gitBrowser.git.diff')}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <GitCommitHorizontal className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RemotesView({ agentId, repoRoot, busy, run }: { agentId: string; repoRoot: string; busy: string | null; run: (label: string, fn: () => Promise<void>) => Promise<void> }) {
  const { t } = useTranslation()
  const [remotes, setRemotes] = useState<GitRemote[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [cloneOpen, setCloneOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setRemotes(await fetchRemotes(agentId, repoRoot))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.na'))
    }
  }, [agentId, repoRoot, t])

  useEffect(() => {
    // Data loads on mount and when the repo changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const doAdd = async () => {
    if (!name.trim() || !url.trim()) {
      return
    }
    await run('remoteAdd', async () => {
      await addRemote(agentId, repoRoot, name.trim(), url.trim())
      setName('')
      setUrl('')
      await load()
    })
  }

  return (
    <div className="p-2">
      <div className="flex items-center gap-2 pb-2">
        <div className="flex flex-1 gap-1">
          <Input value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder={t('gitBrowser.remotes.name')} className="h-7 w-32 text-xs" />
          <Input value={url} onChange={(event: ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)} placeholder={t('gitBrowser.remotes.url')} className="h-7 min-w-0 flex-1 text-xs" onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => event.key === 'Enter' && doAdd()} />
        </div>
        <Button size="sm" className="h-7 gap-1" disabled={busy !== null || !name.trim() || !url.trim()} onClick={doAdd}>
          <Plus className="h-3 w-3" />
          {t('gitBrowser.remotes.add')}
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setCloneOpen(true)}>
          {t('gitBrowser.remotes.clone')}
        </Button>
      </div>
      <div className="rounded-md border">
        {remotes.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{t('gitBrowser.remotes.none')}</p> : null}
        {remotes.map((remote) => (
          <div key={remote.name} className="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0">
            <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{remote.name}</span>
            <span className="truncate text-[11px] text-muted-foreground">{remote.url}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" disabled={busy !== null} onClick={async () => { await run('fetch', () => fetchRemote(agentId, repoRoot, remote.name)); await load(); }}>
                {t('gitBrowser.remotes.fetch')}
              </Button>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" disabled={busy !== null} onClick={async () => { await run('push', () => pushBranch(agentId, repoRoot, { remote: remote.name, setUpstream: true })); await load(); }}>
                {t('gitBrowser.remotes.push')}
              </Button>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-destructive" disabled={busy !== null} onClick={async () => { await run('remoteRemove', () => removeRemote(agentId, repoRoot, remote.name)); await load(); }}>
                {t('common.delete')}
              </Button>
            </span>
          </div>
        ))}
      </div>
      {cloneOpen ? (
        <CloneDialog
          agentId={agentId}
          onDone={() => {
            setCloneOpen(false)
            load()
          }}
        />
      ) : null}
    </div>
  )
}

function CloneDialog({ agentId, onDone }: { agentId: string; onDone: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [url, setUrl] = useState('')
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)

  const doClone = async () => {
    if (!url.trim() || !dir.trim()) {
      return
    }
    setBusy(true)
    try {
      await cloneRepo(agentId, url.trim(), dir.trim())
      toast.success(t('gitBrowser.remotes.cloned'))
      setOpen(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.na'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open: boolean) => { setOpen(open); if (!open) onDone() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('gitBrowser.remotes.cloneTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={url} onChange={(event: ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)} placeholder={t('gitBrowser.remotes.url')} className="h-8 text-xs" />
          <Input value={dir} onChange={(event: ChangeEvent<HTMLInputElement>) => setDir(event.target.value)} placeholder={t('gitBrowser.remotes.dirPlaceholder')} className="h-8 text-xs" />
          <p className="text-[11px] text-muted-foreground">{t('gitBrowser.remotes.dirHint')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={doClone} disabled={busy || !url.trim() || !dir.trim()}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : t('gitBrowser.remotes.clone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---- Tags + Stashes: inner panels of the bottom docks ----

/**
 * TagPanel lists the tags of one repository and creates/deletes them. The list
 * itself is owned by GitTab because the collapsed dock header prints its length,
 * so this panel renders what it is handed; `run` bumps the poll counter, which
 * is what reloads the list after a mutation.
 */
function TagPanel({
  agentId,
  repoRoot,
  tags,
  error,
  busy,
  run,
}: {
  agentId: string
  repoRoot: string
  tags: GitTag[]
  error: string | null
  busy: string | null
  run: (label: string, fn: () => Promise<void>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')

  const doCreate = async () => {
    if (!name.trim()) {
      return
    }
    await run('tagCreate', async () => {
      await createTag(agentId, repoRoot, name.trim())
      setName('')
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="flex shrink-0 items-center gap-1 pb-2">
        <Input value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder={t('gitBrowser.tags.create')} className="h-7 flex-1 text-xs" onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => event.key === 'Enter' && doCreate()} />
        <Button size="sm" className="h-7 gap-1" disabled={busy !== null || !name.trim()} onClick={doCreate}>
          <Plus className="h-3 w-3" />
          {t('gitBrowser.tags.create')}
        </Button>
      </div>
      {error ? <p className="shrink-0 px-1 pb-2 text-[11px] text-destructive">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {tags.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{t('gitBrowser.tags.none')}</p> : null}
        {tags.map((tag) => (
          <div key={tag.name} className="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate font-medium">{tag.name}</span>
            <span className="truncate text-[10px] text-muted-foreground">{tag.sha}</span>
            <Button variant="ghost" size="sm" className="ml-auto h-5 px-1.5 text-[10px] text-destructive" disabled={busy !== null} onClick={() => run('tagDelete', () => deleteTag(agentId, repoRoot, tag.name))}>
              {t('common.delete')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * StashPanel is the stashes counterpart of TagPanel: it pushes new stashes and
 * applies, pops or drops the existing ones, inside the stashes dock.
 */
function StashPanel({
  agentId,
  repoRoot,
  stashes,
  error,
  busy,
  run,
}: {
  agentId: string
  repoRoot: string
  stashes: GitStash[]
  error: string | null
  busy: string | null
  run: (label: string, fn: () => Promise<void>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')

  const doPush = async () => {
    await run('stashPush', async () => {
      await stashAction(agentId, repoRoot, 'push', { message: message.trim() || undefined })
      setMessage('')
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="flex shrink-0 items-center gap-1 pb-2">
        <Input value={message} onChange={(event: ChangeEvent<HTMLInputElement>) => setMessage(event.target.value)} placeholder={t('gitBrowser.stashes.create')} className="h-7 flex-1 text-xs" onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => event.key === 'Enter' && doPush()} />
        <Button size="sm" className="h-7 gap-1" disabled={busy !== null} onClick={doPush}>
          <Plus className="h-3 w-3" />
          {t('gitBrowser.stashes.stash')}
        </Button>
      </div>
      {error ? <p className="shrink-0 px-1 pb-2 text-[11px] text-destructive">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        {stashes.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{t('gitBrowser.stashes.none')}</p> : null}
        {stashes.map((stash, index) => (
          <div key={stash.ref} className="flex items-center gap-2 border-b px-2 py-1 text-xs last:border-b-0">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={cn('font-medium text-muted-foreground')}>{stash.ref}</span>
            <span className="truncate">{stash.subject}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" disabled={busy !== null} onClick={() => run('stashApply', () => stashAction(agentId, repoRoot, 'apply', { index }))}>
                {t('gitBrowser.stashes.apply')}
              </Button>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" disabled={busy !== null} onClick={() => run('stashPop', () => stashAction(agentId, repoRoot, 'pop', { index }))}>
                {t('gitBrowser.stashes.pop')}
              </Button>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-destructive" disabled={busy !== null} onClick={() => run('stashDrop', () => stashAction(agentId, repoRoot, 'drop', { index }))}>
                {t('common.delete')}
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
