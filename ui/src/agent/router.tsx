// The shell's router, as the moved page can reach it.
//
// The page lives in another application, so it cannot import the router: the host
// hands over "go to this path" and the route's query string instead. Only the
// three calls the chat page made are provided.

import { useEffect, type ReactNode } from 'react'
import { getHost } from '../host'

export function useNavigate(): (path: string, options?: { replace?: boolean }) => void {
  return (path: string) => getHost().navigate(path)
}

/** useSearchParams reads the route's query once; the page parses what it needs. */
export function useSearchParams(): [URLSearchParams] {
  return [new URLSearchParams(getHost().query ?? {})]
}

/**
 * Link is the router's anchor: it keeps the href (middle-click and copy work) and
 * routes through the host instead of reloading the page.
 */
export function Link({ to, className, children }: { to: string; className?: string; children?: ReactNode }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          return
        }
        event.preventDefault()
        getHost().navigate(to)
      }}
    >
      {children}
    </a>
  )
}

/** Navigate redirects on mount, as the router's component of the same name does. */
export function Navigate({ to }: { to: string; replace?: boolean }) {
  useEffect(() => {
    getHost().navigate(to)
  }, [to])
  return null
}
