// How the file dialog shows a file: which renderer the body gets, and whether
// the raw text may be changed and saved. Kept pure (no React, no DOM) so the
// node-environment unit tests can pin the dispatch without rendering the dialog.
import type { FileKind } from './fileTypes'

export type ViewerMode = 'preview' | 'source'

// PreviewTarget names the renderer for one (kind, mode) pair. `source` is the
// plain textarea, used both for text files and for the source view of markdown
// and HTML.
export type PreviewTarget =
  | 'sandboxed-html'
  | 'markdown'
  | 'source'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'none'

// previewTarget is the whole dispatch table. NanoWork artifacts only exist as
// their rendered form (both modes); an ordinary HTML page defaults to its
// rendered form but can switch to source; binary documents have no source view.
export function previewTarget(kind: FileKind | null, mode: ViewerMode): PreviewTarget {
  switch (kind) {
    case 'nanowork':
      return 'sandboxed-html'
    case 'html':
      return mode === 'preview' ? 'sandboxed-html' : 'source'
    case 'markdown':
      return mode === 'preview' ? 'markdown' : 'source'
    case 'text':
      return 'source'
    case 'image':
      return 'image'
    case 'pdf':
    case 'docx':
    case 'pptx':
    case 'xlsx':
      return kind
    default:
      return 'none'
  }
}

// canEditSource is true when the raw text may be changed and saved. Rendering a
// page never makes its source editable on its own; HTML follows the same rule
// as markdown and plain text.
export function canEditSource(kind: FileKind | null, canEdit: boolean): boolean {
  if (!canEdit) {
    return false
  }
  return kind === 'text' || kind === 'markdown' || kind === 'html'
}

// showsSourceToggle is true when the header offers the preview/source switch.
// An HTML page always offers it (the source stays readable without edit
// rights); text and markdown keep their existing "only when editable" rule.
export function showsSourceToggle(kind: FileKind | null, canEdit: boolean): boolean {
  if (kind === 'html') {
    return true
  }
  return canEdit && (kind === 'text' || kind === 'markdown')
}
