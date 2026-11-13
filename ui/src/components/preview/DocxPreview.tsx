import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { docxDocumentHtml } from '../../lib/docxHtml'
import { officeFontCss } from '../../lib/previewFonts'

// DocxPreview parses the document with docx-preview, then moves the result into
// a sandboxed frame.
//
// Rendering straight into the page would put the document's stylesheet in the
// portal's DOM. Rendering into a same-origin iframe is not an option either: the
// library builds its nodes with the host `document`. So it renders into a
// detached container here, and the markup is serialised into the frame below —
// with `useBase64URL` on, so images and fonts survive the move as data URLs.
export function DocxPreview({ blob, name }: { blob: Blob; name: string }) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        if (!host) {
          return
        }
        const body = document.createElement('div')
        const styles = document.createElement('div')
        host.replaceChildren(styles, body)
        await renderAsync(blob, body, styles, {
          inWrapper: true,
          breakPages: true,
          // An altChunk is an embedded HTML part; rendering it would insert
          // markup the document controls for no benefit here.
          renderAltChunks: false,
          useBase64URL: true,
        })
        if (!cancelled) {
          setHtml(docxDocumentHtml(styles.innerHTML, body.innerHTML, officeFontCss()))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
      host?.replaceChildren()
    }
  }, [blob])

  return (
    <>
      {/* Off-screen render target: never shown, only serialised. */}
      <div ref={hostRef} className="hidden" aria-hidden="true" />
      {error ? (
        <p className="p-4 text-sm text-destructive">{error}</p>
      ) : html ? (
        <iframe
          title={name}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={html}
          className="h-full w-full border-0 bg-white"
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t('files.previewLoading')}</p>
      )}
    </>
  )
}
