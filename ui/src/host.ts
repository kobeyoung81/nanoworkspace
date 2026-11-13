// The host a panel borrows from the shell.
//
// The file browser is a shell component that moved into this module: it still
// needs the shell's design system, its translations, its notifications and the
// user's token. The shell sets them here for as long as the panel is mounted —
// exactly one page is on screen at a time — so the components below keep their
// original shape instead of threading a context through fifteen files.

import type { PageContext } from './contract'

export type Host = Pick<PageContext, 't' | 'locale' | 'token' | 'userId' | 'ui' | 'api' | 'toast' | 'navigate'>

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
