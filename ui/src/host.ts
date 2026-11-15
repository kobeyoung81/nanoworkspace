// The host a panel borrows from the shell.
//
// The file browser, the git panel and the chat workbench are the shell's own code,
// moved into this module: they still need the shell's design system, its
// translations, its notifications, the user's token and the colour scheme. The
// shell sets them here for as long as the plugin is mounted — exactly one page or
// panel is on screen at a time — so the components keep their original shape
// instead of threading a context through fifty files.

import type { PageContext, PortalFeatures, SessionSnapshot } from './contract'

/**
 * What the shell installs.
 *
 * The kit, strings and data client are what every moved component reads. The rest
 * is optional because the two entry points differ: a page gets the route's query
 * and the shell's features, a workbench panel gets neither (it has no route and
 * asks the workbench, not the shell).
 */
export type Host = Pick<
  PageContext,
  't' | 'locale' | 'token' | 'userId' | 'theme' | 'ui' | 'api' | 'toast' | 'navigate' | 'agentId'
> & {
  session?: SessionSnapshot
  query?: Record<string, string>
  features?: PortalFeatures
}

let current: Host | null = null

/** setHost installs the shell's services; the shell calls it on every render. */
export function setHost(host: Host): void {
  current = host
}

export function getHost(): Host {
  if (!current) {
    throw new Error('the workspace plugin rendered without a host')
  }
  return current
}
