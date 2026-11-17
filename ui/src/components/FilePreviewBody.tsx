import { Suspense, lazy, type ChangeEvent } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { FileContent } from '../hooks/useFileContent'
import { formatBytes } from '../lib/binaryPreview'
import type { FileKind } from '../lib/fileTypes'
import type { PreviewTarget } from '../lib/fileViewer'
import { detectSupportEnv, missingPreviewApis, type PreviewKind, type SupportEnv } from '../lib/previewSupport'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { PreviewErrorBoundary } from './PreviewErrorBoundary'
import { SandboxedHtmlFrame } from './SandboxedHtmlFrame'
import { DocxPreview } from './preview/DocxPreview'
import { PdfPreview } from './preview/PdfPreview'
import { PptxPreview } from './preview/PptxPreview'
import { XlsxPreview } from './preview/XlsxPreview'

// Kept lazy: markdown pulls in the highlighter, which is the single largest
// module the portal loads. Importing it statically from here would fold it into
// the entry chunk and undo the split `AgentPage` already relies on.
const Markdown = lazy(() => import('./Markdown'))

// Capability probing builds a canvas, so it runs once per page rather than on
// every render.
let supportEnv: SupportEnv | null = null
function browserSupport(): SupportEnv {
  supportEnv ??= detectSupportEnv()
  return supportEnv
}

// supportKindFor maps a renderer target onto the capability table. Text, image
// and HTML previews have no engine requirements of their own.
function supportKindFor(target: PreviewTarget): PreviewKind | null {
  switch (target) {
    case 'pdf':
    case 'docx':
    case 'pptx':
    case 'xlsx':
      return target
    default:
      return null
  }
}

type FilePreviewBodyProps = {
  name: string
  kind: FileKind | null
  target: PreviewTarget
  content: FileContent
  /** Bumped by the header's reload button; also resets the error boundary. */
  reloadKey?: number
  /** Current text, when the caller owns it (the dialog's editable source view). */
  text?: string
  onTextChange?: (next: string) => void
  onDownload?: () => void
}

// FilePreviewBody is the single renderer dispatch, shared by the dialog and the
// standalone viewer page. It owns no fetching: the caller passes the loaded
// content so the preview/source toggle never re-downloads.
export function FilePreviewBody({
  name,
  kind,
  target,
  content,
  reloadKey = 0,
  text,
  onTextChange,
  onDownload,
}: FilePreviewBodyProps) {
  const { t } = useTranslation()

  if (content.status === 'loading') {
    return <p className="p-4 text-sm text-muted-foreground">{t('files.previewLoading')}</p>
  }

  if (content.status === 'too-large') {
    return (
      <Problem
        message={t('files.previewTooLarge', { size: formatBytes(content.size) })}
        action={onDownload ? { label: t('files.download'), onClick: onDownload } : null}
      />
    )
  }

  if (content.status === 'error') {
    return (
      <Problem
        message={content.message ? `${t('files.previewFailed')} ${content.message}` : t('files.previewFailed')}
        action={onDownload ? { label: t('files.download'), onClick: onDownload } : null}
      />
    )
  }

  const value = text ?? content.text
  const supportKind = supportKindFor(target)
  const missing = supportKind ? missingPreviewApis(supportKind, browserSupport()) : []
  if (missing.length > 0) {
    return (
      <Problem
        message={t('files.previewUnsupported', { apis: missing.join(' · ') })}
        action={onDownload ? { label: t('files.download'), onClick: onDownload } : null}
      />
    )
  }

  const preview = (() => {
    switch (target) {
      case 'sandboxed-html':
        // NanoWork artifacts and plain pages both run in the opaque-origin frame.
        return <SandboxedHtmlFrame html={content.text} title={name} kind={kind === 'nanowork' ? 'nanowork' : 'html'} />
      case 'markdown':
        return (
          <div className="h-full overflow-y-auto p-4">
            <Suspense fallback={<p className="text-sm text-muted-foreground">{t('files.previewLoading')}</p>}>
              <Markdown>{content.text}</Markdown>
            </Suspense>
          </div>
        )
      case 'source':
        return (
          <Textarea
            value={value}
            onChange={onTextChange ? (event: ChangeEvent<HTMLTextAreaElement>) => onTextChange(event.target.value) : undefined}
            readOnly={!onTextChange}
            className="h-full min-h-0 w-full resize-none rounded-none border-0 bg-transparent p-4 font-mono text-sm focus-visible:ring-0"
          />
        )
      case 'image':
        return content.url ? (
          <div className="flex h-full items-center justify-center overflow-auto p-4">
            <img src={content.url} alt={name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t('files.previewLoading')}</p>
        )
      case 'pdf':
        return content.blob ? <PdfPreview blob={content.blob} /> : null
      case 'docx':
        return content.blob ? <DocxPreview blob={content.blob} name={name} /> : null
      case 'pptx':
        return content.blob ? <PptxPreview blob={content.blob} /> : null
      case 'xlsx':
        return content.blob ? <XlsxPreview blob={content.blob} /> : null
      default:
        return <p className="p-4 text-sm text-muted-foreground">{t('files.openFailed')}</p>
    }
  })()

  // One boundary around the dispatch, keyed by the file: a renderer that throws
  // on a malformed document must not take the panel down with it.
  return (
    <PreviewErrorBoundary
      resetKey={`${name}:${target}:${reloadKey}`}
      fallback={(message) => (
        <Problem
          message={`${t('files.previewRenderFailed')} ${message}`}
          action={onDownload ? { label: t('files.download'), onClick: onDownload } : null}
        />
      )}
    >
      {preview}
    </PreviewErrorBoundary>
  )
}

function Problem({ message, action }: { message: string; action: { label: string; onClick: () => void } | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {action ? (
        <Button variant="outline" size="sm" onClick={action.onClick}>
          <Download className="h-3.5 w-3.5" />
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
