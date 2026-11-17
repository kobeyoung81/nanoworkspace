// The shell's translator, for the few places the chat surface needs one outside a
// component (error messages raised by the data client).

import { getHost } from '../../host'

const i18n = {
  get language(): string {
    return getHost().locale || 'en'
  },
  t: (key: string, options?: Record<string, unknown>): string => getHost().t(key, options),
}

export default i18n
