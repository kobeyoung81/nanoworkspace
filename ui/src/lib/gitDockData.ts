import { useCallback, useEffect, useState } from 'react'
import { fetchStashes, fetchTags, type GitStash, type GitTag } from './gitApi'

/** Items of a docked list plus the error to show inline when loading failed. */
export type DockList<T> = {
  items: T[]
  error: string | null
}

/**
 * useRepoList keeps one repository list (tags or stashes) in sync for a docked
 * panel. Docked panels print their entry count while collapsed, so the list is
 * loaded eagerly rather than only when the panel opens, and it refreshes on
 * every poll tick — GitTab bumps its poll counter every 15 seconds and after
 * each mutation.
 *
 * Failures stay silent here: a collapsed header must not raise a toast every
 * 15 seconds. The message is handed back instead, and the expanded panel renders
 * it inline.
 */
function useRepoList<T>(
  repoRoot: string | null,
  poll: number,
  fetchItems: (repoRoot: string) => Promise<T[]>,
): DockList<T> {
  const [items, setItems] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!repoRoot) {
      setItems([])
      setError(null)
      return
    }
    try {
      setItems(await fetchItems(repoRoot))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [repoRoot, fetchItems])

  useEffect(() => {
    // Reloads when the repository changes and on every poll tick.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, poll])

  return { items, error }
}

/** Tags of one repository, kept fresh for the tags dock. */
export function useTagList(agentId: string | null, repoRoot: string | null, poll: number): DockList<GitTag> {
  const fetchItems = useCallback(
    async (root: string) => (agentId ? fetchTags(agentId, root) : []),
    [agentId],
  )
  return useRepoList<GitTag>(repoRoot, poll, fetchItems)
}

/** Stashes of one repository, kept fresh for the stashes dock. */
export function useStashList(agentId: string | null, repoRoot: string | null, poll: number): DockList<GitStash> {
  const fetchItems = useCallback(
    async (root: string) => (agentId ? fetchStashes(agentId, root) : []),
    [agentId],
  )
  return useRepoList<GitStash>(repoRoot, poll, fetchItems)
}
