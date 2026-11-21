import { describe, expect, it } from 'vitest'
import { splitUtilityLayersInCss } from './splitUtilityLayers'

// The transform decides which side of the cascade a rule lands on, and getting it
// wrong is invisible in the source — it shows up as a desktop rendered in the
// phone layout, or as a five-column row collapsed to two. These checks pin both
// halves of that contract.
describe('splitUtilityLayers', () => {
  it('keeps base rules in the plugin layer and moves variants into the shell layer', () => {
    const input = [
      '@layer plugin{',
      '.hidden{display:none}',
      '.flex{display:flex}',
      '@media (min-width:40rem){.sm\\:block{display:block}}',
      '@media (min-width:64rem){.lg\\:grid-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}}',
      '}',
    ].join('')

    const out = splitUtilityLayersInCss(input)

    // Base rules stay where the shell's utilities outrank them.
    expect(out).toMatch(/@layer plugin\{[^@]*\.hidden\{display:none\}/)
    // Variants leave the plugin layer…
    const pluginBlock = out.slice(out.indexOf('@layer plugin{'), out.indexOf('}') + 1)
    expect(pluginBlock).not.toContain('@media')
    // …and land in the shell's own layer, last in the file.
    const utilitiesAt = out.lastIndexOf('@layer utilities{')
    expect(utilitiesAt).toBeGreaterThan(out.indexOf('@layer plugin{'))
    expect(out.slice(utilitiesAt)).toContain('.lg\\:grid-cols-5')
    // Breakpoint order survives: sm before lg.
    expect(out.indexOf('.sm\\:block')).toBeLessThan(out.indexOf('.lg\\:grid-cols-5'))
  })

  it('leaves a sheet without variants alone', () => {
    const input = '@layer plugin{.hidden{display:none}}'
    expect(splitUtilityLayersInCss(input)).toBe(input)
  })

  it('does not touch layers that are not ours', () => {
    const input = '@layer properties{*{--x:0}}@layer plugin{.flex{display:flex}}@layer utilities{.sm\\:block{display:block}}'
    const out = splitUtilityLayersInCss(input)
    expect(out).toContain('@layer properties{*{--x:0}}')
    expect(out).toContain('@layer plugin{.flex{display:flex}}')
  })
})
