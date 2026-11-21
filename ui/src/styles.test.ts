import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

// The module builds its own utilities. This used to be the shell's job ("the
// stylesheet is the shell's"), which only worked while the shell carried a copy
// of the chat: Tailwind scans the project it is built in, so every utility only
// the plugin used was emitted from the shell's sources in the copy, and vanished
// the moment the copy was deleted. The chat's page-height class was one of them —
// without it the workbench grew past the window and pushed the composer and the
// footer out. These checks pin the wiring that keeps that from coming back.
describe('the workspace module ships its own utilities', () => {
  const styles = read('./styles.css')

  it('imports the utilities layer without a second preflight', () => {
    expect(styles).toContain("tailwindcss/utilities.css")
    expect(styles).toContain("tailwindcss/theme.css")
    // The shell owns the base rules; a second reset this late on the page would
    // restyle the shell's own surfaces.
    expect(styles).not.toMatch(/@import\s+['"]tailwindcss['"]/)
  })

  it('keeps its utilities out of the shell\'s layer', () => {
    // This sheet lands in <head> after the shell's, and inside one layer the
    // later file wins: a bare `.hidden` here beat the shell's `.sm\:block` and
    // every `hidden sm:block` vanished on a desktop. `plugin` is declared by the
    // shell below `utilities`, so the shell's variants win again.
    expect(styles).toContain("utilities.css' layer(plugin)")
    expect(styles).not.toContain("utilities.css' layer(utilities)")

    const statement = /@layer\s+([a-z,\s-]+);/.exec(styles)
    expect(statement, 'no @layer statement in styles.css').not.toBeNull()
    const layers = statement![1].split(',').map((layer) => layer.trim())
    expect(layers).toContain('plugin')
    expect(layers).toContain('utilities')
    expect(layers.indexOf('plugin')).toBeLessThan(layers.indexOf('utilities'))
  })

  it('maps the shell palette names onto the shell variables', () => {
    for (const token of [
      '--color-background',
      '--color-card',
      '--color-muted-foreground',
      '--color-primary',
      '--color-border',
      '--color-success',
      '--color-warning',
      '--color-info',
      '--color-sidebar',
    ]) {
      expect(styles).toContain(token)
    }
  })

  it('is imported by both module entries', () => {
    expect(read('./pages.tsx')).toContain("import './styles.css'")
    expect(read('./panels.tsx')).toContain("import './styles.css'")
  })

  it('runs Tailwind in the module build', () => {
    expect(read('../vite.config.ts')).toContain("@tailwindcss/vite")
    expect(read('../vite.config.ts')).toContain('tailwindcss(),')
  })
})
