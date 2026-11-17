// The shell's notifications, for the components that used to import theirs.
//
// This bundle has its own `sonner` singleton, and its toasts never reach the
// shell's <Toaster>. The proxy keeps the call sites (`toast.success(...)`) and
// forwards to the host.

import { getHost } from '../../host'

type Options = Record<string, unknown>

type Toast = {
  (message: string): void
  success: (message: string, ...rest: [Options?]) => void
  info: (message: string, ...rest: [Options?]) => void
  warning: (message: string, ...rest: [Options?]) => void
  error: (message: string, ...rest: [Options?]) => void
}

export const toast: Toast = Object.assign(
  (message: string) => getHost().toast.info(message),
  {
    success: (message: string) => getHost().toast.success(message),
    info: (message: string) => getHost().toast.info(message),
    warning: (message: string) => getHost().toast.warning(message),
    error: (message: string) => getHost().toast.error(message),
  },
)
