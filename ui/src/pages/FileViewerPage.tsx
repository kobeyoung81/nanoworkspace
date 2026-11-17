// The standalone preview: the same body the file dialog shows, in a real browser
// tab. It reads its file from the query string so the address can be refreshed,
// bookmarked or sent to another signed-in tab.
//
// Everything it needs at runtime (the strings, the notifications, the token) comes
// from the host the shell installs; the preview stack it renders is this module's
// own, which is why the page lives here rather than in the shell.

import { useEffect, useState } from 'react'
import { ArrowLeft, Code, Download, Eye, FileText } from 'lucide-react'

import { FilePreviewBody } from '../components/FilePreviewBody'
import { PreviewReloadButton } from '../components/PreviewReloadButton'
import { Button } from '../ui/button'
import { useFileContent } from '../hooks/useFileContent'
import { classifyFileType } from '../lib/fileTypes'
import { downloadToDisk } from '../lib/fileDownload'
import { previewTarget, showsSourceToggle, type ViewerMode } from '../lib/fileViewer'
import { getHost } from '../host'

/** The viewer's inputs, read once from the address bar. */
function viewerParams(): { agentId: string; path: string; mode: ViewerMode } {
  const params = new URLSearchParams(window.location.search)
  return {
    agentId: params.get('agent') ?? '',
    path: params.get('path') ?? '',
    mode: params.get('mode') === 'source' ? 'source' : 'preview',
  }
}

export function FileViewerPage() {
  const host = getHost()
  const { t } = host
  const [{ agentId, path, mode: initialMode }] = useState(viewerParams)
  const [mode, setMode] = useState<ViewerMode>(initialMode)
  const [reloadKey, setReloadKey] = useState(0)

  const name = path.split('/').pop() ?? ''
  const fileType = classifyFileType(name)
  const target = previewTarget(fileType, mode)
  const content = useFileContent(agentId, path, fileType, reloadKey)

  useEffect(() => {
    document.title = name || t('files.title')
  }, [name, t])

  const handleDownload = async () => {
    try {
      await downloadToDisk(agentId, path, name)
    } catch (err) {
      host.toast.error(err instanceof Error ? err.message : t('files.downloadFailed'))
    }
  }

  if (!agentId || !path) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center" data-admin-page="file-view">
        <p className="text-sm text-muted-foreground">{t('files.viewerMissing')}</p>
        <Button variant="outline" size="sm" onClick={() => host.navigate(`/files?agent=${encodeURIComponent(agentId)}`)}>
          <ArrowLeft className="h-4 w-4" />
          {t('files.title')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background" data-admin-page="file-view">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t('files.title')}
          onClick={() => host.navigate(`/files?agent=${encodeURIComponent(agentId)}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate font-mono text-sm font-medium" title={path}>
          {name}
        </h1>
        {showsSourceToggle(fileType, true) ? (
          mode === 'preview' ? (
            <Button variant="ghost" size="sm" onClick={() => setMode('source')}>
              <Code className="h-3.5 w-3.5" />
              {t('files.source')}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setMode('preview')}>
              <Eye className="h-3.5 w-3.5" />
              {t('files.preview')}
            </Button>
          )
        ) : null}
        <PreviewReloadButton loading={content.status === 'loading'} onClick={() => setReloadKey((key) => key + 1)} />
        <Button variant="ghost" size="sm" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          {t('files.download')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <FilePreviewBody
          name={name}
          kind={fileType}
          target={target}
          content={content}
          reloadKey={reloadKey}
          onDownload={handleDownload}
        />
      </div>
    </div>
  )
}
