// Metric-compatible stand-ins for the fonts Office documents ask for.
//
// A .docx/.pptx records a font *name*, not the font itself. When the machine
// lacks it the browser substitutes something unrelated (often Times), and from
// there every line break and column width is wrong — the preview "drifts" even
// though nothing failed. Each rule below tries the real font first via
// `local(...)`, then the metric-compatible open font, so a machine that has
// Office sees no change at all.
//
// The files live in `web/public/fonts/` (stable URLs, CORS-enabled by nginx) so
// a sandboxed iframe can reference them by absolute path.

export type OfficeFontAlias = {
  /** Family name as it appears in the document. */
  family: string
  /** Local names to prefer before falling back to the bundled file. */
  local: readonly string[]
  /** File name under /fonts/. */
  file: string
  weight: 400 | 700
}

function family(familyName: string, local: readonly string[], base: string): OfficeFontAlias[] {
  return [400, 700].map((weight) => ({
    family: familyName,
    local,
    file: `${base}-latin-${weight}-normal.woff2`,
    weight: weight as 400 | 700,
  }))
}

// Carlito/Caladea/Arimo/Tinos/Cousine are the metric-compatible counterparts of
// Calibri/Cambria/Arial/Times New Roman/Courier New (all OFL-2 / Apache-2.0).
export const OFFICE_FONT_ALIASES: readonly OfficeFontAlias[] = [
  ...family('Calibri', ['Calibri'], 'carlito'),
  ...family('Cambria', ['Cambria'], 'caladea'),
  ...family('Arial', ['Arial', 'ArialMT'], 'arimo'),
  ...family('Helvetica', ['Helvetica', 'Helvetica Neue'], 'arimo'),
  ...family('Times New Roman', ['Times New Roman', 'TimesNewRomanPSMT'], 'tinos'),
  ...family('Times', ['Times'], 'tinos'),
  ...family('Courier New', ['Courier New', 'CourierNewPSMT'], 'cousine'),
  ...family('Courier', ['Courier'], 'cousine'),
]

/** Quote a value for a CSS string, so a name with a quote cannot break the rule. */
function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// officeFontCss renders the @font-face rules. `basePath` is where the files are
// served from; the sandboxed iframe needs an absolute path.
export function officeFontCss(
  aliases: readonly OfficeFontAlias[] = OFFICE_FONT_ALIASES,
  basePath = '/fonts/',
): string {
  return aliases
    .map(({ family: familyName, local, file, weight }) => {
      const sources = [
        ...local.map((name) => `local("${cssString(name)}")`),
        `url(${basePath}${file}) format("woff2")`,
      ].join(',')
      return `@font-face{font-family:"${cssString(familyName)}";src:${sources};font-weight:${weight};font-style:normal;font-display:swap}`
    })
    .join('')
}
