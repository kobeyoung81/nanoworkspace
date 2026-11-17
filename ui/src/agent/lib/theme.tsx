// The colour scheme, as the shell chose it.
//
// The chat surface reads it to pick the diff/highlight variant; the choice itself
// is the shell's (it owns the toggle and the stored preference), so this only
// reports what the host installed.

import { getHost } from '../../host'

export function useTheme(): { theme: 'light' | 'dark'; resolvedTheme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void } {
  const theme = getHost().theme ?? 'light'
  return { theme, resolvedTheme: theme, setTheme: () => {} }
}
