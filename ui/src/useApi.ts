// The smallest data hook a page needs, built on the context's client.
//
// The shell has a richer one; a page cannot import it, and this is all these
// screens ask for: a value, a loading flag, an error and a way to refetch.

import { useCallback, useEffect, useState } from 'react'
import type { PageContext } from './contract'

export function useApi<T>(
  api: PageContext['api'],
  path: string | null,
  base?: string,
): {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (path === null) {
      return
    }
    let alive = true
    setLoading(true)
    api
      .get<T>(path, base)
      .then((value) => {
        if (alive) {
          setData(value)
          setError(null)
        }
      })
      .catch((failure: unknown) => {
        if (alive) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [api, path, base, attempt])

  const refetch = useCallback(() => setAttempt((value) => value + 1), [])
  return { data, loading, error, refetch }
}

/** useDebounce delays a fast-changing value; a list filters as you type. */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
