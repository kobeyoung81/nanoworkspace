// The shell's translator, for the few places the browser needs one outside a
// component (the file-name rules and the date format). Inside components the
// usual `useTranslation` works: the plugin renders in the shell's tree, under the
// shell's i18n provider.

import { getHost } from './host'

const i18n = {
  get language(): string {
    const host = getHost()
    return host.locale || 'en'
  },
  t: (key: string, options?: Record<string, unknown>): string => getHost().t(key, options),
}

export default i18n
