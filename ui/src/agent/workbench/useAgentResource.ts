import { useCallback, useEffect, useState } from 'react'

type ResourceState<T> = {
  forAgent: string | null
  data: T | null
  error: string | null
}

// useAgentResource loads agent-scoped data and keeps it correct across agent
// switches without synchronous setState-in-effect: results are tagged with the
// agent they were fetched for, and data/error are only exposed when they match
// the current agentId (loading resolves implicitly). Optional polling covers
// panels that need live data (e.g. sub-agent jobs) without new plumbing.
export function useAgentResource<T>(
  agentId: string | null,
  fetcher: (id: string) => Promise<T>,
  opts?: { refreshIntervalMs?: number },
): {
  data: T | null
  error: string | null
  loading: boolean
  refresh: () => void
  setData: (updater: (prev: T | null) => T | null) => void
} {
  const [state, setState] = useState<ResourceState<T>>({ forAgent: null, data: null, error: null })
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    if (!agentId) {
      return
    }
    let ignore = false
    fetcher(agentId)
      .then((data) => {
        if (!ignore) {
          setState({ forAgent: agentId, data, error: null })
        }
      })
      .catch((err: Error) => {
        if (!ignore) {
          setState({ forAgent: agentId, data: null, error: err.message })
        }
      })
    return () => {
      ignore = true
    }
  }, [agentId, fetcher, tick])

  useEffect(() => {
    const ms = opts?.refreshIntervalMs
    if (!ms || !agentId) {
      return
    }
    const id = window.setInterval(() => setTick((t) => t + 1), ms)
    return () => window.clearInterval(id)
  }, [agentId, opts?.refreshIntervalMs])

  const matched = state.forAgent === agentId
  // setData only accepts an updater function so the union of value | function
  // cannot confuse TS's parameter inference at call sites. It is memoized so
  // consumers can safely use it in effect deps (an unstable identity here torn
  // down the terminal WebSocket on every render).
  const setData = useCallback(
    (updater: (prev: T | null) => T | null) => {
      setState((prev) => ({ forAgent: agentId, data: updater(prev.data), error: null }))
    },
    [agentId],
  )
  return {
    data: matched ? state.data : null,
    error: matched ? state.error : null,
    loading: Boolean(agentId) && !matched,
    refresh,
    setData,
  }
}