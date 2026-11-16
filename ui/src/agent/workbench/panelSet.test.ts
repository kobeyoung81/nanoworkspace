import { describe, expect, it } from 'vitest'
import { buildPanelSet } from './panelSet'
import type { WorkbenchPlugin } from './types'

const plugin = (id: string): WorkbenchPlugin => ({
  id,
  icon: (() => null) as unknown as WorkbenchPlugin['icon'],
  title: id,
  defaultSlot: 'center',
  Component: () => null,
})

describe('buildPanelSet', () => {
  it('keeps the declared order of this module’s panels', () => {
    const { order } = buildPanelSet({ chat: plugin('chat'), agents: plugin('agents') }, ['agents', 'chat'], [])
    expect(order).toEqual(['agents', 'chat'])
  })

  it('appends the panels other plugins contribute', () => {
    // The library and document panels come from the artifacts manifest; when the
    // workbench stopped asking the shell's registry they vanished from the
    // activity bar, which is what this list prevents.
    const { order, modules } = buildPanelSet({ chat: plugin('chat') }, ['chat'], [
      {
        id: 'nanoartifacts.library',
        title: '作品库',
        icon: () => null,
        defaultSlot: 'right',
        Component: () => null,
      },
    ])
    expect(order).toEqual(['chat', 'nanoartifacts.library'])
    expect(modules['nanoartifacts.library'].ctxAware).toBe(true)
    expect(modules['nanoartifacts.library'].title).toBe('作品库')
  })

  it('skips an id this module already declares', () => {
    const { order } = buildPanelSet({ chat: plugin('chat') }, ['chat'], [
      { id: 'chat', title: 'stolen', icon: () => null, defaultSlot: 'center', Component: () => null },
    ])
    expect(order).toEqual(['chat'])
  })

  it('ignores an order entry with no implementation', () => {
    const { order } = buildPanelSet({ chat: plugin('chat') }, ['chat', 'missing'], [])
    expect(order).toEqual(['chat'])
  })
})
