// Limits for the binary previewers.
//
// Downloads go through the agent hypervisor, which reads the whole file into
// memory, and through the portal proxy, which buffers it again. A document far
// beyond the 10 MiB upload cap is therefore not worth parsing in the browser:
// past this point the dialog offers the download instead of a preview.
import type { FileKind } from './fileTypes'

export const MAX_PREVIEW_BYTES = 15 << 20

// PreviewRowLimit caps how much of a worksheet is put in the DOM.
export const SHEET_ROW_LIMIT = 500

// TEXT_KINDS are shown as text: they have always been read whole and stay
// unlimited so the existing viewer behaviour does not change.
export const TEXT_KINDS: ReadonlySet<FileKind> = new Set(['text', 'markdown', 'html', 'nanowork'])

// previewTooLarge reports whether the binary viewers should refuse this file.
// An unknown size (no listing entry) is not a reason to refuse.
export function previewTooLarge(kind: FileKind | null, bytes: number | undefined): boolean {
  if (kind === null || TEXT_KINDS.has(kind)) {
    return false
  }
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return false
  }
  return bytes > MAX_PREVIEW_BYTES
}

// sheetWindow trims a worksheet to the first `limit` rows and says whether it
// had to drop anything.
export function sheetWindow<T>(rows: readonly T[], limit = SHEET_ROW_LIMIT): { rows: T[]; truncated: boolean } {
  if (rows.length <= limit) {
    return { rows: rows.slice(), truncated: false }
  }
  return { rows: rows.slice(0, limit), truncated: true }
}

// formatBytes renders a size for the "too large to preview" notice.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Number(value.toFixed(1))
  return `${rounded} ${units[unit]}`
}
