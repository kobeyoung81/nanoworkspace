import { describe, expect, it } from 'vitest'
import { canonicalPanelId } from './pluginIds'

// The workbench moved into this module with its panels, and the layout it reads
// was written by the shell. Both older ids must land on the panel that exists
// here, or a browser that had the git panel open reopens with an empty dock.
describe('canonicalPanelId', () => {
  it('maps the renamed agent config panel onto its new id', () => {
    expect(canonicalPanelId('agent-config')).toBe('user-config')
  })

  it('maps both git ids onto this application’s panel', () => {
    expect(canonicalPanelId('git-browser')).toBe('git')
    expect(canonicalPanelId('workspace.git')).toBe('git')
  })

  it('leaves every other id alone', () => {
    for (const id of ['agents', 'chat', 'files', 'terminal', 'user-config', 'git']) {
      expect(canonicalPanelId(id)).toBe(id)
    }
  })
})
