import { describe, expect, it } from 'vitest'
import viewerSource from './FileViewerPage.tsx?raw'

// The standalone viewer is this module's page; the shell only routes to it. Its
// reload wiring has to stay in step with the shared button, and none of it is
// observable without a DOM — so the source is pinned, the way the shell pinned it
// before the page moved here with the /files/view route.

describe('preview reload in the standalone viewer', () => {
  it('mounts the shared button and passes its own counter to the loader', () => {
    expect(viewerSource).toContain('<PreviewReloadButton')
    expect(viewerSource).toContain('useFileContent(agentId, path, fileType, reloadKey)')
  })
})
