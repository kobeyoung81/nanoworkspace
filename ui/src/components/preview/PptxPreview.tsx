import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ensureOfficeFonts } from '../../lib/officeFontsDom'

type PptxViewerHandle = import('@aiden0z/pptx-renderer').PptxViewer

// PptxPreview renders every slide as HTML/SVG inside this container. The library
// keeps live nodes (charts are canvases, slides mount in a windowed list), so the
// result cannot be serialised the way a docx is — it stays mounted here.
export function PptxPreview({ blob }: { blob: Blob }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let cancelled = false
    let viewer: PptxViewerHandle | null = null
    container.replaceChildren()
    void (async () => {
      try {
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer')
        // Slides are positioned from measured text, so the substitute fonts must
        // be ready before the first layout pass.
        await ensureOfficeFonts()
        const opened = await PptxViewer.open(blob, container, {
          // The deck comes from an agent workspace: cap the zip before parsing.
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          // Embedded media still renders; only remote relationships are dropped.
          externalMedia: 'block',
          // pdfjs is only needed for EMF previews; leave it out of the bundle.
          pdfjs: false,
          listOptions: { windowed: true },
        })
        if (cancelled) {
          opened.destroy()
          return
        }
        viewer = opened
        setReady(true)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
      viewer?.destroy()
      container.replaceChildren()
    }
  }, [blob])

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full overflow-auto bg-muted/40 p-3" />
      {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
      {!error && !ready ? (
        <p className="p-4 text-sm text-muted-foreground">{t('files.previewLoading')}</p>
      ) : null}
    </div>
  )
}
