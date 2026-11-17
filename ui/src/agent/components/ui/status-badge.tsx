// The shell's component, forwarded from the host (see ../../../../ui/shim).

import { pick } from './shim'

import { getHost } from '../../../host'

/** The shell's status→tone mapping, for a badge whose status is a domain word. */
export function toneForStatus(status: string) {
  return getHost().ui.toneForStatus(status)
}

export const StatusBadge = pick('StatusBadge')
