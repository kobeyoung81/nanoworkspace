import { OFFICE_FONT_ALIASES, officeFontCss } from './previewFonts'

const STYLE_ID = 'office-preview-fonts'

// ensureOfficeFonts installs the @font-face rules in the portal document once
// and resolves only after the substitutes can be measured.
//
// PowerPoint decks are laid out from measured text metrics, so the renderer must
// not start while a substitute font is still loading — it would measure the
// fallback and place every run for the wrong width.
export async function ensureOfficeFonts(): Promise<void> {
  if (typeof document === 'undefined') {
    return
  }
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = officeFontCss()
    document.head.appendChild(style)
  }
  if (!document.fonts) {
    return
  }
  await Promise.all(
    OFFICE_FONT_ALIASES.map((alias) =>
      document.fonts.load(`${alias.weight} 16px "${alias.family}"`).catch(() => []),
    ),
  ).catch(() => undefined)
  await document.fonts.ready.catch(() => undefined)
}
