// The shell's notifications, for the components that used to import theirs.
//
// The plugin bundle has its own `sonner` singleton, and its toasts never reach the
// shell's <Toaster>. This proxy keeps the call sites (`toast.success(...)`) and
// forwards to the host the shell installs.

import { getHost } from '../host'

type Options = Record<string, unknown>

type Toast = {
  (message: string): void
  success: (message: string, ...rest: [Options?]) => void
  info: (message: string, ...rest: [Options?]) => void
  error: (message: string, ...rest: [Options?]) => void
}

/** The shell's notification, in the shape the call sites already use. */
export const toast: Toast = Object.assign(
  (message: string) => getHost().toast.info(message),
  {
    success: (message: string) => getHost().toast.success(message),
    info: (message: string) => getHost().toast.info(message),
    error: (message: string) => getHost().toast.error(message),
  },
)
