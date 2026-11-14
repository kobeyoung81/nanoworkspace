import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Star,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import {
  type GitChangeStatus,
  type GitFileEntry,
  type GitMarker,
  listGitDir,
} from '../../lib/gitApi'
import { buildDirtyDirs, buildStatusIndex, type NodeStatus } from '../../lib/gitStatus'
import { Spinner } from '../../ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip'

type TreeRowProps = {
  agentId: string | null
  relPath: string
  entry: GitFileEntry
  depth: number
  statusIndex: Map<string, NodeStatus>
  dirtyDirs: Set<string>
  starred: Set<string>
  /** Incremented on every tree refresh; re-reads the open directories. */
  version: number
  defaultOpen?: boolean
  onOpen: (entry: GitFileEntry, relPath: string) => void
  onToggleStar: (relPath: string, isDir: boolean, name: string) => void
}

// PREFIX_OK is the set of RGB histograms we render for file icons; the icons
// below mirror FilePanel's classification.
function fileIcon(name: string): { icon: typeof File; className: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const type = new Set(['md', 'markdown']).has(ext)
    ? 'md'
    : new Set(['txt', 'text', 'log', 'csv', 'json', 'yaml', 'yml', 'js', 'ts', 'py', 'go', 'sh', 'html', 'css', 'toml', 'xml']).has(ext)
      ? 'code'
      : new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']).has(ext)
        ? 'image'
        : null
  if (type === 'image') {
    return { icon: FileImage, className: 'h-4 w-4 shrink-0 text-info' }
  }
  if (type === 'md') {
    return { icon: FileText, className: 'h-4 w-4 shrink-0 text-primary' }
  }
  if (type === 'code') {
    return { icon: FileCode, className: 'h-4 w-4 shrink-0 text-muted-foreground' }
  }
  return { icon: File, className: 'h-4 w-4 shrink-0 text-muted-foreground' }
}

// dotTone maps a change tone to the colour of the right-edge change indicator.
const dotTone: Record<GitMarker['tone'], string> = {
  added: 'bg-success',
  modified: 'bg-warning',
  deleted: 'bg-destructive',
  untracked: 'bg-muted-foreground',
  conflicted: 'bg-destructive',
  renamed: 'bg-info',
}

function MarkerBadge({ marker }: { marker?: GitMarker }) {
  if (!marker) {
    return null
  }
  const tone =
    marker.tone === 'added'
      ? 'bg-success/15 text-success'
      : marker.tone === 'modified'
        ? 'bg-warning/15 text-warning'
        : marker.tone === 'deleted'
          ? 'bg-destructive/15 text-destructive'
          : marker.tone === 'untracked'
            ? 'bg-muted text-muted-foreground'
            : marker.tone === 'renamed'
              ? 'bg-info/15 text-info'
              : 'bg-destructive/20 text-destructive' // conflicted
  return (
    <span
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold leading-none',
        tone,
      )}
      title={`${marker.letter} (${marker.tone})`}
    >
      {marker.letter}
    </span>
  )
}

function TreeRow({ agentId, relPath, entry, depth, statusIndex, dirtyDirs, starred, version, defaultOpen = false, onOpen, onToggleStar }: TreeRowProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const [children, setChildren] = useState<GitFileEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const loadedRef = useRef(false)

  const status = statusIndex.get(relPath)
  const hasChanges = status !== undefined
  // The precomputed set answers "is anything changed at or below this path?" for
  // files and directories alike, at every level of the tree.
  const dirDirty = dirtyDirs.has(relPath)
  const dirty = hasChanges || dirDirty
  const isStarred = starred.has(relPath)

  // A directory is read when it opens and re-read on every tree refresh while it
  // stays open, so files created or deleted elsewhere show up. Collapsed rows are
  // left untouched (they are read when expanded again) and the expanded state
  // survives a refresh, which is what keeps the tree from collapsing underfoot.
  useEffect(() => {
    if (!open || !agentId) {
      return
    }
    let cancelled = false
    if (!loadedRef.current) {
      setLoading(true)
    }
    listGitDir(agentId, relPath)
      .then((listing) => {
        if (cancelled) {
          return
        }
        setChildren(listing.entries)
        loadedRef.current = true
      })
      .catch(() => {
        if (!cancelled) {
          setChildren(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [agentId, relPath, open, version])

  const toggle = useCallback(() => {
    if (!entry.is_dir) {
      return
    }
    setOpen((prev) => !prev)
  }, [entry.is_dir])

  const indent = { paddingLeft: `${8 + depth * 14}px` }
  const Icon = entry.is_dir ? (open ? FolderOpen : Folder) : fileIcon(entry.name).icon

  return (
    <>
      <div
        className={cn(
          'group flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-sm pr-1 text-[13px] hover:bg-accent/60',
          dirDirty && 'font-medium',
        )}
        style={indent}
        onClick={toggle}
        onDoubleClick={() => onOpen(entry, relPath)}
        title={t('gitBrowser.tree.open')}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {entry.is_dir ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : null}
        </span>
        <span className="shrink-0">
          <Icon className={cn('h-4 w-4', entry.is_dir ? 'text-info' : fileIcon(entry.name).className)} />
        </span>
        <span
          className={cn(
            'truncate',
            hasChanges && status?.marker?.tone === 'deleted' && 'text-destructive line-through',
            isStarred && 'text-primary',
          )}
        >
          {entry.name}
        </span>

        {status ? <MarkerBadge marker={status.marker} /> : null}

        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* The change indicator comes first so its dot lands in the same
              column on every row (it marks the whole path from a changed file
              up to the tree root). */}
          {dirty ? (
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center"
              title={status?.marker ? `${status.marker.letter} (${status.marker.tone})` : t('gitBrowser.tree.containsChanges')}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  status?.marker ? dotTone[status.conflicts ? 'conflicted' : status.marker.tone] : 'bg-warning',
                )}
              />
            </span>
          ) : null}
          {/* The favourite slot holds its width on rows without a star, which is
              what keeps the dot column straight. */}
          {entry.is_dir ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn('flex h-5 w-5 items-center justify-center rounded hover:bg-accent', isStarred && 'opacity-100')}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleStar(relPath, true, entry.name)
                  }}
                  aria-label={isStarred ? t('gitBrowser.tree.unstar') : t('gitBrowser.tree.star')}
                >
                  <Star className={cn('h-3.5 w-3.5', isStarred ? 'fill-primary text-primary' : 'text-muted-foreground')} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{isStarred ? t('gitBrowser.tree.unstar') : t('gitBrowser.tree.star')}</TooltipContent>
            </Tooltip>
          ) : (
            <span aria-hidden className="h-5 w-5 shrink-0" />
          )}
        </span>
      </div>
      {open && entry.is_dir ? (
        loading ? (
          <div style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }} className="flex h-6 items-center gap-1 text-muted-foreground">
            <Spinner className="h-3 w-3" />
          </div>
        ) : children ? (
          children.map((child) => (
            <TreeRow
              key={child.name}
              agentId={agentId}
              relPath={relPath ? `${relPath}/${child.name}` : child.name}
              entry={child}
              depth={depth + 1}
              statusIndex={statusIndex}
              dirtyDirs={dirtyDirs}
              starred={starred}
              version={version}
              onOpen={onOpen}
              onToggleStar={onToggleStar}
            />
          ))
        ) : null
      ) : null}
    </>
  )
}

export type FileTreeProps = {
  agentId: string | null
  rootPath: string
  rootLabel: string
  statuses: GitChangeStatus[]
  starred: Set<string>
  /** Incremented by the owner on every refresh that should re-read open dirs. */
  version: number
  onOpen: (entry: GitFileEntry, relPath: string) => void
  onToggleStar: (relPath: string, isDir: boolean, name: string) => void
}

export function FileTree({ agentId, rootPath, rootLabel, statuses, starred, version, onOpen, onToggleStar }: FileTreeProps) {
  const statusIndex = useMemo(() => buildStatusIndex(statuses), [statuses])
  const dirtyDirs = useMemo(() => buildDirtyDirs(statuses), [statuses])
  return (
    <div role="tree" aria-label={rootLabel} className="min-h-0 flex-1 overflow-auto px-1 py-1">
      {agentId ? (
        <TreeRow
          key={`root-${rootPath}`}
          agentId={agentId}
          relPath={rootPath}
          entry={{ name: rootLabel, is_dir: true }}
          depth={0}
          statusIndex={statusIndex}
          dirtyDirs={dirtyDirs}
          starred={starred}
          version={version}
          defaultOpen
          onOpen={onOpen}
          onToggleStar={onToggleStar}
        />
      ) : null}
    </div>
  )
}