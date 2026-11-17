import { useState } from 'react'
import { Code, Download, ExternalLink, Eye, FileText, Maximize2, Minimize2, Pencil, Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { uploadFile } from '../api'
import { classifyFileType } from '../lib/fileTypes'
import { getHost } from '../host'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { canEditSource, previewTarget, showsSourceToggle, type ViewerMode } from '../lib/fileViewer'
import { viewerHref } from '../lib/fileViewerUrl'
import { downloadToDisk } from '../lib/fileDownload'
import { useFileContent } from '../hooks/useFileContent'
import { cn } from '../lib/utils'
import { FilePreviewBody } from './FilePreviewBody'
import { PreviewReloadButton } from './PreviewReloadButton'

export function FileDialog({
  open,
  onOpenChange,
  agentId,
  path,
  name,
  canEdit,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  path: string
  name: string
  canEdit: boolean
  onChanged?: () => void
}) {
  const [mode, setMode] = useState<ViewerMode>('preview')
  // Edits live next to the loaded text instead of in it: the content is fetched
  // once per file, so a draft is only valid for the path it was typed against.
  const [draft, setDraft] = useState<{ path: string; text: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const { t } = useTranslation()
  const toast = getHost().toast

  const fileType = classifyFileType(name)
  const target = previewTarget(fileType, mode)
  const content = useFileContent(agentId, path, fileType, reloadKey)
  const text = draft && draft.path === path ? draft.text : content.status === 'ready' ? content.text : ''
  const sourceEditable = canEditSource(fileType, canEdit) && mode === 'source'

  const handleSave = async () => {
    setSaving(true)
    try {
      await uploadFile(agentId, path, new Blob([text], { type: 'text/plain' }))
      toast.success(t('common.saved'))
      onChanged?.()
      setDraft(null)
      setReloadKey((key) => key + 1)
      setMode('preview')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async () => {
    try {
      await downloadToDisk(agentId, path, name)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.downloadFailed'))
    }
  }

  // Re-fetch and rebuild. The draft is dropped: a half-edited copy must not hide
  // the bytes that just came back from disk.
  const handleReload = () => {
    setDraft(null)
    setReloadKey((key) => key + 1)
  }

  // A real browser tab, not a blob URL: see `lib/fileViewerUrl.ts` for why the
  // HTML preview must stay inside the sandboxed frame.
  const handleOpenInNewTab = () => {
    window.open(viewerHref(agentId, path, mode), '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 p-0',
          fullscreen
            ? 'h-screen max-h-screen w-screen max-w-none rounded-none'
            : // A definite height, not just min/max: a rendered document has no
              // intrinsic height, so with only a lower bound an HTML page sat at
              // the floor while a long markdown file grew to the ceiling.
              'h-[85vh] max-h-[85vh] w-[calc(100%-2rem)] sm:w-[70vw] sm:max-w-[70vw]',
        )}
        showCloseButton={false}
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <DialogTitle className="truncate font-mono text-sm font-medium">{name}</DialogTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {showsSourceToggle(fileType, canEdit) ? (
              mode === 'preview' ? (
                <Button variant="ghost" size="sm" onClick={() => setMode('source')}>
                  {fileType === 'html' ? <Code className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                  {fileType === 'html' ? t('files.source') : t('common.edit')}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setMode('preview')}>
                  <Eye className="h-3.5 w-3.5" />
                  {t('files.preview')}
                </Button>
              )
            ) : null}
            <PreviewReloadButton loading={content.status === 'loading'} onClick={handleReload} />
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              {t('files.download')}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFullscreen((v) => !v)}
                  aria-label={fullscreen ? t('files.exitFullscreen') : t('files.viewFullscreen')}
                >
                  {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">
                    {fullscreen ? t('files.exitFullscreen') : t('files.viewFullscreen')}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{fullscreen ? t('files.exitFullscreen') : t('files.viewFullscreen')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenInNewTab}
                  aria-label={t('files.openInNewTab')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('files.openInNewTab')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('files.openInNewTab')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onOpenChange(false)}
                  aria-label={t('common.close')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common.close')}</TooltipContent>
            </Tooltip>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          <FilePreviewBody
            name={name}
            kind={fileType}
            target={target}
            content={content}
            reloadKey={reloadKey}
            text={text}
            onTextChange={sourceEditable ? (next) => setDraft({ path, text: next }) : undefined}
            onDownload={handleDownload}
          />
        </div>

        {sourceEditable ? (
          <DialogFooter className="border-t px-4 py-3">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
