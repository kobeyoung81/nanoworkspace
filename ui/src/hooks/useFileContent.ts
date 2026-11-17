// One file is read once per open: every renderer gets either its text or its
// bytes. Nothing is fetched again when the header switches between preview and
// source, so an edit in the textarea survives the toggle.
import { useEffect, useState } from 'react'

import { downloadFile } from '../api'
import { TEXT_KINDS, previewTooLarge } from '../lib/binaryPreview'
import type { FileKind } from '../lib/fileTypes'

export type FileContent =
  | { status: 'loading' }
  | { status: 'ready'; blob: Blob; text: string; url: string | null }
  | { status: 'too-large'; size: number }
  | { status: 'error'; message: string }

function requestKey(agentId: string, path: string, kind: FileKind | null, reloadKey: number): string {
  return [agentId, path, kind ?? '', reloadKey].join('\u0000')
}

// useFileContent loads a file from the agent's workspace. `kind` decides how it
// is decoded (not the viewer mode): text kinds are decoded once, an image gets
// an object URL, and the binary document renderers keep the raw Blob.
//
// Loaded content is stamped with the request it belongs to, so a new file (or a
// reload after saving) shows "loading" until its own bytes arrive — no state is
// reset synchronously inside the effect.
export function useFileContent(
  agentId: string,
  path: string,
  kind: FileKind | null,
  reloadKey = 0,
): FileContent {
  const key = requestKey(agentId, path, kind, reloadKey)
  const [loaded, setLoaded] = useState<{ key: string; content: FileContent } | null>(null)

  useEffect(() => {
    if (!agentId || !path) {
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    const settle = (content: FileContent) => {
      if (!cancelled) {
        setLoaded({ key, content })
      }
    }

    void (async () => {
      try {
        const blob = await downloadFile(agentId, path)
        if (cancelled) {
          return
        }
        if (previewTooLarge(kind, blob.size)) {
          settle({ status: 'too-large', size: blob.size })
          return
        }
        if (kind !== null && TEXT_KINDS.has(kind)) {
          const text = await blob.text()
          settle({ status: 'ready', blob, text, url: null })
          return
        }
        if (kind === 'image') {
          // Revoked by the cleanup below, so reopening a file cannot pile up
          // blob URLs (the previous version leaked one per image).
          objectUrl = URL.createObjectURL(blob)
          settle({ status: 'ready', blob, text: '', url: objectUrl })
          return
        }
        settle({ status: 'ready', blob, text: '', url: null })
      } catch (err) {
        settle({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [agentId, path, kind, reloadKey, key])

  if (!agentId || !path) {
    return { status: 'error', message: 'missing agent or path' }
  }
  return loaded && loaded.key === key ? loaded.content : { status: 'loading' }
}
