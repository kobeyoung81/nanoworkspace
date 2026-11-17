// The mobile workbench's default panel set.
//
// On a phone the workbench shows one panel at a time, so the set of open panels
// is the only navigation there is: it defaults to the three a session needs —
// the agent list, the conversation and the files — in that order, with the
// conversation showing first. A browser that has stored its own set keeps it;
// this is only the seed.

/** The plugins a phone opens with, in tab order. */
export const MOBILE_DEFAULT_TABS = ['agents', 'chat', 'files'] as const

/** Which of them the phone shows first. */
export const MOBILE_DEFAULT_ACTIVE = 'chat'

/**
 * The mobile tab set for a build shipping `pluginIds`: the defaults that exist,
 * in order. A manifest with none of them falls back to its first plugin, so the
 * phone is never left with no way to switch panels.
 */
export function defaultMobileTabs(pluginIds: string[]): string[] {
  const known = new Set(pluginIds)
  const tabs = MOBILE_DEFAULT_TABS.filter((id) => known.has(id))
  return tabs.length > 0 ? tabs : pluginIds.slice(0, 1)
}

/** Which of `tabs` the phone shows first. */
export function defaultMobileActive(tabs: string[]): string | null {
  return tabs.includes(MOBILE_DEFAULT_ACTIVE) ? MOBILE_DEFAULT_ACTIVE : (tabs[0] ?? null)
}
