import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { Button } from '../../ui/button'

// Pages rendered up front. A long document is paged in batches so opening a
// 200-page PDF does not stall the dialog.
const PAGE_BATCH = 20

// PdfPreview renders every page to its own canvas, fitted to the container
// width. A text layer (selection/search) is deliberately not part of this yet.
export function PdfPreview({ blob }: { blob: Blob }) {
  const { t } = useTranslation()
  const pagesRef = useRef<HTMLDivElement | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [visible, setVisible] = useState(PAGE_BATCH)
  const [containerWidth, setContainerWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
        ])
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const data = new Uint8Array(await blob.arrayBuffer())
        const opened = await pdfjs.getDocument({ data }).promise
        if (cancelled) {
          void opened.destroy()
          return
        }
        loaded = opened
        setDoc(opened)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
      if (loaded) {
        void loaded.destroy()
      }
    }
  }, [blob])

  // Re-render when the container is resized: the page canvas is rasterised at a
  // fixed width, so a different width needs a different scale.
  useEffect(() => {
    const container = pagesRef.current
    if (!doc || !container || typeof ResizeObserver === 'undefined') {
      return
    }
    let timer = 0
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setContainerWidth((prev) => (Math.abs(prev - next) > 8 ? next : prev)), 200)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [doc])

  useEffect(() => {
    const container = pagesRef.current
    if (!doc || !container) {
      return
    }
    let cancelled = false
    container.replaceChildren()
    void (async () => {
      try {
        const width = container.clientWidth || 720
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const last = Math.min(visible, doc.numPages)
        for (let pageNumber = 1; pageNumber <= last; pageNumber++) {
          const page = await doc.getPage(pageNumber)
          if (cancelled) {
            return
          }
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: width / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * ratio)
          canvas.height = Math.floor(viewport.height * ratio)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          canvas.className = 'max-w-full rounded-sm bg-white shadow-sm'
          container.appendChild(canvas)
          const context = canvas.getContext('2d')
          if (!context) {
            continue
          }
          await page.render({
            canvas,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          }).promise
          page.cleanup()
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, visible, containerWidth])

  if (error) {
    return <p className="p-4 text-sm text-destructive">{error}</p>
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/40 p-3">
      <div ref={pagesRef} className="mx-auto flex max-w-4xl flex-col items-center gap-3" />
      {doc === null ? <p className="py-6 text-center text-sm text-muted-foreground">{t('files.previewLoading')}</p> : null}
      {doc && visible < doc.numPages ? (
        <div className="flex justify-center py-3">
          <Button variant="outline" size="sm" onClick={() => setVisible((n) => n + PAGE_BATCH)}>
            {t('files.pdfLoadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
