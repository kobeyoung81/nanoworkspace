// Which viewer opens a file, decided by extension alone.
//
// This lives outside `api.ts` (which pulls in i18n and therefore `document`) so it
// stays pure logic that the node-environment unit tests can import — see the note
// in `vitest.config.ts`.
//
// The mapping is also the whole safety story for HTML: NanoWork artifacts and
// plain `.html` pages are rendered in a sandboxed iframe (see `FileDialog`), so
// being "openable" here means "handed to that sandbox", never "injected into the
// portal document".
//
// Binary documents (pdf / docx / pptx / xlsx) are opened by their own renderers,
// which parse them in the browser and never hand the bytes to the portal DOM as
// markup. Legacy binary Office formats (.doc / .xls / .ppt) stay unsupported on
// purpose: they are OLE2 compound documents, which none of those parsers read.

export type FileKind =
  | 'text'
  | 'markdown'
  | 'html'
  | 'image'
  | 'nanowork'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'

// NANOWORK_EXTENSIONS are the compiled NanoWork artifacts: complete, self-contained
// HTML documents (styles, scripts and assets all inlined). Keep in sync with the
// CLI's kind → extension mapping, which is always `.n` + kind.
export const NANOWORK_EXTENSIONS = ['ndoc', 'nppt', 'nui', 'npro'] as const

// HTML_EXTENSIONS are ordinary web pages: rendered as a document rather than
// shown as source. `.htm` is the legacy spelling of the same thing.
export const HTML_EXTENSIONS = ['html', 'htm'] as const

// Office Open XML documents: zip containers with a documented part layout.
export const DOCX_EXTENSIONS = ['docx'] as const
export const PPTX_EXTENSIONS = ['pptx'] as const
export const XLSX_EXTENSIONS = ['xlsx'] as const

// classifyFileType returns the viewer/editor type for a file
// name, or null when the type is not supported by the "Open" viewer.
export function classifyFileType(name: string): FileKind | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if ((NANOWORK_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'nanowork'
  }
  if (['md', 'markdown'].includes(ext)) {
    return 'markdown'
  }
  if ((HTML_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'html'
  }
  if (['txt', 'text', 'log', 'csv', 'json', 'yaml', 'yml', 'js', 'ts', 'py', 'go', 'sh', 'css', 'toml', 'xml'].includes(ext)) {
    return 'text'
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return 'image'
  }
  if (ext === 'pdf') {
    return 'pdf'
  }
  if ((DOCX_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'docx'
  }
  if ((PPTX_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'pptx'
  }
  if ((XLSX_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'xlsx'
  }
  return null
}

export function canOpenFile(name: string): boolean {
  return classifyFileType(name) !== null
}
