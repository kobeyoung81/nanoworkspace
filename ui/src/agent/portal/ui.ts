// The shell's component kit and data client, reached through the host.
//
// The moved workbench passes these to its panels; the values are read on every
// access so a host that re-installs its services is picked up without remounting.

import { getHost } from '../../host'
import type { PortalApi, PortalUIText } from '../../contract'

export const portalUI = new Proxy({} as PortalUIText, {
  get(_target, name: string) {
    return (getHost().ui as unknown as Record<string, unknown>)[name]
  },
})

export const portalApi: PortalApi = {
  get: (path, base) => getHost().api.get(path, base),
  post: (path, body, base) => getHost().api.post(path, body, base),
  put: (path, body, base) => getHost().api.put(path, body, base),
  patch: (path, body, base) => getHost().api.patch(path, body, base),
  del: (path, base) => getHost().api.del(path, base),
  get bases() {
    return getHost().api.bases
  },
}
