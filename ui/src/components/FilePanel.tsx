import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  ClipboardPaste,
  Columns,
  Copy,
  CornerUpLeft,
  Download,
  Eye,
  File,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  FolderTree,
  LayoutDashboard,
  Pencil,
  Presentation,
  RefreshCw,
  Scissors,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import {
    copyEntry,
  createFolder,
  deleteFile,
  downloadFile,
  fileListingPath,
  listFiles,
  renameEntry,
  uploadFile,
} from '../api'
import type { FileEntry, FileListing } from '../api'
import { fallbackTarget, readAgentPath, writeAgentPath } from '../lib/browsingPath'
import { canOpenFile, classifyFileType } from '../lib/fileTypes'
import { previewTooLarge } from '../lib/binaryPreview'
import { createChannelLogger } from '../lib/debug'
import { getHost, setHost } from '../host'
import type { PageContext } from '../contract'
import { useApi } from '../useApi'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { FormField } from '../ui/form-field'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { FileDialog } from './FileDialog'
import { cn } from '../lib/utils'

function formatSize(bytes?: number): string {
  if (bytes === undefined) {
    return '—'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatModified(modified?: number): string {
  if (!modified) {
    return '—'
  }
  return new Date(modified * 1000).toLocaleString(i18n.language)
}

function fileIcon(name: string): {
  icon: typeof File
  className: string
} {
  const type = classifyFileType(name)
  if (type === 'nanowork') {
    return { icon: LayoutDashboard, className: 'h-4 w-4 shrink-0 text-primary' }
  }
  if (type === 'image') {
    return { icon: FileImage, className: 'h-4 w-4 shrink-0 text-info' }
  }
  if (type === 'markdown' || type === 'text' || type === 'pdf' || type === 'docx') {
    return { icon: FileText, className: 'h-4 w-4 shrink-0 text-primary' }
  }
  if (type === 'xlsx') {
    return { icon: FileSpreadsheet, className: 'h-4 w-4 shrink-0 text-primary' }
  }
  if (type === 'pptx') {
    return { icon: Presentation, className: 'h-4 w-4 shrink-0 text-primary' }
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['json', 'yaml', 'yml', 'js', 'ts', 'py', 'go', 'sh', 'html', 'css', 'toml', 'xml'].includes(ext)) {
    return { icon: FileCode, className: 'h-4 w-4 shrink-0 text-muted-foreground' }
  }
  return { icon: File, className: 'h-4 w-4 shrink-0 text-muted-foreground' }
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

const log = createChannelLogger('fileBrowser')

// Structural entries that must not be deleted/renamed/copied/cut (the server
// enforces the same protection; the UI disables the actions for clarity).
const PROTECTED_NAMES = new Set(['sharedspace', 'agent', 'sessions', 'cron.json', 'media'])

// copyPasteName returns a non-conflicting destination name for a copy: the plain
// name first, then "name (copy).ext", "name (copy 2).ext", ...
function copyPasteName(base: string, exists: (name: string) => boolean): string {
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let candidate = base
  for (let i = 1; exists(candidate); i++) {
    candidate = `${stem} (copy${i > 1 ? ` ${i}` : ''})${ext}`
  }
  return candidate
}

// validateFileName returns an error message for an invalid entry name, or
// null when the name may be used. Names must be non-empty, not a dot entry, and
// free of path separators and duplicates within the current directory.
function validateFileName(next: string, original: string, siblings: FileEntry[]): string | null {
  const trimmed = next.trim()
  if (!trimmed) {
    return i18n.t('files.nameEmpty')
  }
  if (trimmed === '.' || trimmed === '..') {
    return i18n.t('files.invalidName')
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return i18n.t('files.nameSlashes')
  }
  if (trimmed === original) {
    return null
  }
  if (siblings.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase())) {
    return i18n.t('files.nameExists')
  }
  return null
}

function IconButton({
  tooltip,
  label,
  disabled,
  onClick,
  className,
  children,
}: {
  tooltip: string
  label: string
  disabled?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', className)}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function FilePanel({
  ctx,
  agentId,
  allowUpload = true,
}: {
  ctx: PageContext
  agentId: string | null
  allowUpload?: boolean
}) {
  // The browser is the shell's own code: it renders here but borrows the shell's
  // kit, strings, notifications and token through the host.
  setHost(ctx)
  const { api, toast, navigate } = ctx
  const { t } = useTranslation()
  const [path, setPath] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [viewer, setViewer] = useState<FileEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; path: string; name: string } | null>(null)

  const listingPath = agentId ? fileListingPath(agentId, path) : null
  const { data, loading, error, refetch } = useApi<FileListing>(api, listingPath, api.bases.workspace)

  const entries = data?.entries ?? []

  // Resume where this agent was left browsing; empty means its home. Another
  // agent's directory is never carried over.
  useEffect(() => {
    // Reading the per-agent path out of storage on an agent switch is an
    // intentional external-state effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPath(readAgentPath('fileBrowser', agentId) ?? '')
  }, [agentId])

  // A remembered directory can be gone (the agent was re-provisioned, a folder
  // was deleted), and the listing then fails with the server's raw error. Fall
  // back to the agent's home instead — but only when the home answers: a
  // restarting container or a failing tunnel must keep the path the user was on.
  useEffect(() => {
    if (!agentId || !error || path === '') {
      return
    }
    let cancelled = false
    // The skeleton stands in for the error while the probe runs: the error that
    // triggered it is the server's raw one for a path that is about to be
    // dropped.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecovering(true)
    listFiles(agentId, '')
      .then(() => {
        if (cancelled || fallbackTarget(path, true) !== 'default') {
          return
        }
        log.info(`the remembered path is gone (${path}); back to the agent home`)
        writeAgentPath('fileBrowser', agentId, '')
        setPath('')
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setRecovering(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [agentId, error, path])

  const navigateTo = (nextPath: string) => {
    setPath(nextPath)
    if (agentId) {
      writeAgentPath('fileBrowser', agentId, nextPath)
    }
    setSelected(null)
    setRenameTarget(null)
    setRenameValue('')
  }

  const goUp = () => {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    navigateTo(parts.join('/'))
  }

  const handleSelect = (entry: FileEntry) => {
    setSelected(entry)
  }

  const handleDownload = async (entry: FileEntry) => {
    if (!agentId) {
      return
    }
    try {
      const blob = await downloadFile(agentId, joinPath(path, entry.name))
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = entry.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.downloadFailed'))
    }
  }

  // handleOpen navigates into folders and opens viewable files (falling back to
  // download for binary files). Triggered by double-click and the Open button.
  const handleOpen = (entry: FileEntry) => {
    if (!agentId) {
      return
    }
    if (entry.is_dir) {
      navigateTo(joinPath(path, entry.name))
      return
    }
    if (!canOpenFile(entry.name)) {
      void handleDownload(entry)
      return
    }
    // The listing already knows the size: refuse a document that would only
    // stall the browser before downloading it into memory.
    if (previewTooLarge(classifyFileType(entry.name), entry.size)) {
      toast.error(t('files.previewTooLarge', { size: formatSize(entry.size) }))
      void handleDownload(entry)
      return
    }
    setViewer(entry)
  }

  const startRename = () => {
    if (!selected) {
      return
    }
    setRenameTarget(selected)
    setRenameValue(selected.name)
  }

  const cancelRename = () => {
    setRenameTarget(null)
    setRenameValue('')
  }

  const commitRename = async () => {
    if (!agentId || !renameTarget) {
      return
    }
    const next = renameValue.trim()
    if (next === renameTarget.name) {
      cancelRename()
      return
    }
    const invalid = validateFileName(renameValue, renameTarget.name, entries)
    if (invalid) {
      toast.error(invalid)
      cancelRename()
      return
    }
    try {
      await renameEntry(agentId, joinPath(path, renameTarget.name), joinPath(path, next))
      toast.success(t('files.renamedTo', { name: next }))
      setSelected({ name: next, is_dir: renameTarget.is_dir })
      cancelRename()
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.renameFailed'))
    }
  }

  const handleDelete = async () => {
    if (!agentId || !deleteTarget) {
      return
    }
    setDeleteBusy(true)
    try {
      await deleteFile(agentId, joinPath(path, deleteTarget.name))
      toast.success(t('files.deleted', { name: deleteTarget.name }))
      if (selected?.name === deleteTarget.name) {
        setSelected(null)
      }
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.deleteFailed'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleCopy = () => {
    if (!selected || PROTECTED_NAMES.has(selected.name)) {
      return
    }
    setClipboard({ mode: 'copy', path: joinPath(path, selected.name), name: selected.name })
    toast.success(t('files.copied', { name: selected.name }))
  }

  const handleCut = () => {
    if (!selected || PROTECTED_NAMES.has(selected.name)) {
      return
    }
    setClipboard({ mode: 'cut', path: joinPath(path, selected.name), name: selected.name })
    toast.success(t('files.cutToast', { name: selected.name }))
  }

  const handlePaste = async () => {
    if (!agentId || !clipboard) {
      return
    }
    const exists = (name: string) => entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())
    const sameDir = clipboard.path === joinPath(path, clipboard.name)

    if (clipboard.mode === 'copy') {
      if (sameDir) {
        toast.error(t('files.alreadyExistsInFolder'))
        return
      }
    } else if (sameDir) {
      setClipboard(null)
      toast.info(t('files.nothingToMove'))
      return
    } else if (exists(clipboard.name)) {
      toast.error(t('files.nameExists'))
      return
    }

    const destName = clipboard.mode === 'copy' ? copyPasteName(clipboard.name, exists) : clipboard.name
    const to = joinPath(path, destName)
    try {
      if (clipboard.mode === 'copy') {
        await copyEntry(agentId, clipboard.path, to)
        toast.success(t('files.copiedTo', { name: clipboard.name, dest: destName }))
      } else {
        await renameEntry(agentId, clipboard.path, to)
        toast.success(t('files.movedTo', { name: clipboard.name, dest: destName }))
      }
      setClipboard(null)
      setSelected(null)
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : clipboard.mode === 'copy' ? t('files.copyFailed') : t('files.moveFailed'))
    }
  }

  const isRenaming = (entry: FileEntry) => renameTarget?.name === entry.name

  const viewerPath = viewer ? joinPath(path, viewer.name) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 shrink-0 items-center gap-1 border-b px-2 py-1">
        <IconButton tooltip={t('files.up')} label={t('files.up')} disabled={!path || !agentId} onClick={goUp}>
          <FolderTree className="h-4 w-4 text-primary" />
        </IconButton>
        {path
          ? (() => {
              const segments = path.split('/').filter(Boolean)
              return (
                <>
                  {segments.map((segment, index) => (
                    <button
                      key={`${index}-${segment}`}
                      type="button"
                      onClick={() => navigateTo(segments.slice(0, index + 1).join('/'))}
                      className="truncate rounded px-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title={path}
                    >
                      {index > 0 ? `\u00A0/ ${segment}` : segment}
                    </button>
                  ))}
                </>
              )
            })()
          : null}
        <div className="ml-auto">
          <IconButton
            tooltip={t('files.fullscreen')}
            label={t('files.openFullPage')}
            disabled={!agentId}
            onClick={() => agentId && navigate(`/files?agent=${encodeURIComponent(agentId)}`)}
          >
            <Columns className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="flex items-center gap-0.5 border-b px-3 py-1.5">
        <IconButton
          tooltip={t('files.newFolder')}
          label={t('files.createFolder')}
          disabled={!allowUpload || !agentId}
          onClick={() => setNewFolderOpen(true)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('common.open')}
          label={t('files.openSelected')}
          disabled={!selected || !agentId}
          onClick={() => selected && handleOpen(selected)}
        >
          <Eye className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('common.rename')}
          label={t('files.renameSelected')}
          disabled={!allowUpload || !selected || PROTECTED_NAMES.has(selected.name) || !agentId}
          onClick={startRename}
        >
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('common.copy')}
          label={t('files.copySelected')}
          disabled={!allowUpload || !selected || PROTECTED_NAMES.has(selected.name) || !agentId}
          onClick={handleCopy}
        >
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('files.cut')}
          label={t('files.cutSelected')}
          disabled={!allowUpload || !selected || PROTECTED_NAMES.has(selected.name) || !agentId}
          onClick={handleCut}
        >
          <Scissors className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('files.paste')}
          label={t('files.pasteIntoFolder')}
          disabled={!allowUpload || !clipboard || !agentId}
          onClick={handlePaste}
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('files.upload')}
          label={t('files.uploadFile')}
          disabled={!allowUpload || !agentId}
          onClick={() => setUploadOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('files.download')}
          label={t('files.downloadSelected')}
          disabled={!selected || selected.is_dir || !agentId}
          onClick={() => selected && handleDownload(selected)}
        >
          <Download className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          tooltip={t('common.delete')}
          label={t('files.deleteSelected')}
          disabled={!allowUpload || !selected || PROTECTED_NAMES.has(selected.name) || !agentId}
          onClick={() => selected && setDeleteTarget(selected)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
        <div className="ml-auto">
          <IconButton tooltip={t('common.refresh')} label={t('files.refresh')} disabled={!agentId} onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {!agentId ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <EmptyState
            icon={FolderTree}
            title={t('files.noAgentTitle')}
            description={t('files.selectAgent')}
            className="w-full"
          />
        </div>
      ) : loading || recovering ? (
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="w-full space-y-2 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('common.retry')}
            </Button>
          </div>
        </div>
      ) : data ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          <Table scrollable={false}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('files.name')}</TableHead>
                <TableHead>{t('files.modified')}</TableHead>
                <TableHead className="text-right">{t('files.size')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {path ? (
                <TableRow className="cursor-pointer" onDoubleClick={goUp}>
                  <TableCell className="flex items-center gap-2 font-medium text-muted-foreground">
                    <CornerUpLeft className="h-4 w-4 shrink-0" />
                    <span>..</span>
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              ) : null}
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    {t('files.emptyDirectory')}
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => {
                  const selectedEntry = selected?.name === entry.name
                  const renaming = isRenaming(entry)
                  const fileIconInfo = entry.is_dir ? null : fileIcon(entry.name)
                  return (
                    <TableRow
                      key={entry.name}
                      data-state={selectedEntry ? 'selected' : undefined}
                      className="cursor-pointer"
                      onClick={() => handleSelect(entry)}
                      onDoubleClick={() => handleOpen(entry)}
                    >
                      <TableCell className="flex items-center gap-2 font-medium">
                        {entry.is_dir ? (
                          <Folder className="h-4 w-4 shrink-0 text-info" />
                        ) : fileIconInfo ? (
                          <fileIconInfo.icon className={fileIconInfo.className} />
                        ) : null}
                      {renaming ? (
                        <RenameInput
                          value={renameValue}
                          onChange={setRenameValue}
                          onCommit={commitRename}
                          onCancel={cancelRename}
                        />
                      ) : (
                        <span className="truncate">{entry.name}</span>
                      )}
                      {entry.runtime ? (
                        <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                          {t('files.runtime')}
                        </Badge>
                      ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatModified(entry.modified)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {entry.is_dir ? '—' : formatSize(entry.size)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {newFolderOpen ? (
        <NewFolderDialog
          open
          onOpenChange={setNewFolderOpen}
          agentId={agentId}
          dir={path}
          existingNames={entries.map((entry) => entry.name)}
          onCreated={() => {
            setNewFolderOpen(false)
            refetch()
          }}
        />
      ) : null}

      {uploadOpen ? (
        <UploadDialog
          open
          onOpenChange={setUploadOpen}
          agentId={agentId}
          dir={path}
          onUploaded={() => {
            setUploadOpen(false)
            refetch()
          }}
        />
      ) : null}

      {viewer && agentId && viewerPath ? (
        <FileDialog
          open
          onOpenChange={() => setViewer(null)}
          agentId={agentId}
          path={viewerPath}
          name={viewer.name}
          canEdit={allowUpload}
          onChanged={() => refetch()}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
        title={t('files.deleteTitle', { name: deleteTarget?.name ?? t('common.file') })}
        description={t('files.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
        busy={deleteBusy}
      />
    </div>
  )
}

function RenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  return (
    <Input
      ref={ref}
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      onClick={(event: MouseEvent) => event.stopPropagation()}
      onDoubleClick={(event: MouseEvent) => event.stopPropagation()}
      onBlur={onCommit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      className="h-7 w-full min-w-0 px-2"
    />
  )
}

function NewFolderDialog({
  open,
  onOpenChange,
  agentId,
  dir,
  existingNames,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string | null
  dir: string
  existingNames: string[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()
  const toast = getHost().toast

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('files.folderNameEmpty'))
      return
    }
    if (trimmed === '.' || trimmed === '..') {
      setError(t('files.invalidName'))
      return
    }
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      setError(t('files.folderNameSlashes'))
      return
    }
    if (existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      setError(t('files.folderNameExists'))
      return
    }
    if (!agentId) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createFolder(agentId, joinPath(dir, trimmed))
      toast.success(t('files.createdFolder', { name: trimmed }))
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('files.createFolderFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('files.newFolder')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormField label={t('files.folderName')} error={error ?? undefined}>
            <Input
              value={name}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
              placeholder={t('files.folderPlaceholder')}
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? t('files.creating') : t('files.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UploadDialog({
  open,
  onOpenChange,
  agentId,
  dir,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string | null
  dir: string
  onUploaded: () => void
}) {
  const toast = getHost().toast
  const [file, setFile] = useState<File | null>(null)
  const [targetDir, setTargetDir] = useState(dir)
  const [busy, setBusy] = useState(false)
  const { t } = useTranslation()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!agentId || !file) {
      return
    }
    setBusy(true)
    try {
      const filename = file.name.trim()
      const target = targetDir.trim()
      await uploadFile(agentId, joinPath(target, filename), file)
      toast.success(t('files.uploaded', { name: filename }))
      onUploaded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('files.uploadFile')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormField label={t('common.file')}>
            <Input
              type="file"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </FormField>
          <FormField label={t('files.targetSubfolder')} hint={t('files.targetHint')}>
            <Input value={targetDir} onChange={(event: ChangeEvent<HTMLInputElement>) => setTargetDir(event.target.value)} placeholder={t('files.subfolderPlaceholder')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !file}>
              {busy ? t('files.uploading') : t('files.upload')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
