import { describe, expect, it } from 'vitest'
import manifest from '../public/plugin.json'
import remoteConfig from '../vite.config.ts?raw'
import contract from './contract.ts?raw'
import pages from './pages.tsx?raw'

// This application renders inside the portal's tree and may not import the shell's
// source: the kit (the file panel included), the strings and the data client all
// arrive through the page context.

describe('the boundary', () => {
  it('imports only its own modules, react and icons', () => {
    const imports = [...pages.matchAll(/from '([^']+)'/g)].map((match) => match[1])
    const external = imports.filter((spec) => !spec.startsWith('.'))
    expect(external.sort()).toEqual(['lucide-react', 'react'])
  })

  it('embeds the shell file panel instead of rebuilding it', () => {
    expect(pages).toContain('FilePanel')
    expect(pages).not.toContain("from '../components")
    expect(pages).not.toContain("from '../lib")
  })

  it('declares the page in the manifest and exposes it under /plugins/workspace/', () => {
    expect(manifest.pages.map((page) => page.path)).toEqual(['/files'])
    expect(manifest.entry).toBe('/plugins/workspace/remoteEntry.js')
    expect(remoteConfig).toContain("'./pages': './src/pages.tsx'")
    expect(remoteConfig).toContain("base: '/plugins/workspace/'")
  })

  it('mirrors the portal contract fields the page uses', () => {
    for (const field of ['t:', 'ui:', 'api:', 'navigate:', 'toast:', 'params:', 'features:']) {
      expect(contract).toContain(field)
    }
  })
})
