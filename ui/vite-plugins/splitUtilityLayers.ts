import postcss, { type ChildNode } from 'postcss'
import type { Plugin } from 'vite'

const PLUGIN_LAYER = 'plugin'
const SHELL_LAYER = 'utilities'

/**
 * Splits this module's Tailwind output between two cascade layers.
 *
 * The stylesheet is appended to <head> after the shell's, and inside one layer the
 * later file wins. Two things have to be true at once, and they pull in opposite
 * directions:
 *
 * - a bare `.hidden` here must not beat the shell's `.sm\:block`, or the shell's
 *   `hidden sm:block` / `hidden md:flex` stay hidden on a desktop → base rules go
 *   one layer down, into `plugin`;
 * - `lg:grid-cols-5` must beat the shell's `sm:grid-cols-2` on the same element,
 *   and a layer outranks a media query, so a variant cannot sit below the shell's
 *   utilities → variants share the shell's own layer.
 *
 * Tailwind emits both kinds together. After the build, everything inside an
 * `@media` is a variant (rule order within the file already encodes the
 * breakpoint order); everything else is a base rule.
 */
export function splitUtilityLayers(): Plugin {
  return {
    name: 'nanosec-split-utility-layers',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset' || !output.fileName.endsWith('.css')) {
          continue
        }
        const source = typeof output.source === 'string'
          ? output.source
          : Buffer.from(output.source).toString('utf8')
        output.source = splitUtilityLayersInCss(source)
      }
    },
  }
}

/** Exported for the unit test: the transform on its own, without Vite. */
export function splitUtilityLayersInCss(css: string): string {
  const root = postcss.parse(css)
  const variants: ChildNode[] = []

  root.walkAtRules('layer', (atRule) => {
    if (atRule.params.trim() !== PLUGIN_LAYER || !atRule.nodes) {
      return
    }
    // Copy the list: `remove()` mutates the container we are walking.
    for (const node of [...atRule.nodes]) {
      if (node.type === 'atrule' && node.name === 'media') {
        variants.push(node)
        node.remove()
      }
    }
  })

  if (variants.length === 0) {
    return root.toString()
  }

  const shell = postcss.atRule({ name: 'layer', params: SHELL_LAYER })
  shell.append(variants)
  // Last in the file on purpose: the variants have to come after any base rule
  // of this sheet as well as after the shell's.
  root.append(shell)
  return root.toString()
}
