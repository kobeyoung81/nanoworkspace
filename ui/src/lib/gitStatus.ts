import {
  changeMarker,
  isConflictXY,
  renameSourcePath,
  type GitChangeStatus,
  type GitMarker,
  type GitRepoSummary,
} from './gitApi'

export type NodeStatus = {
  marker: GitMarker
  conflicts: boolean
  path: string
}

// buildStatusIndex flattens a repo status into a map keyed by path so any
// directory or file row can look up its git decoration in O(1).
export function buildStatusIndex(changes: GitChangeStatus[]): Map<string, NodeStatus> {
  const index = new Map<string, NodeStatus>()
  for (const change of changes) {
    const path = renameSourcePath(change.path)
    index.set(path, {
      marker: changeMarker(change),
      conflicts: isConflictXY(change.xy),
      path,
    })
  }
  return index
}

// buildDirtyDirs lists every directory that holds a change at or below it, so a
// tree row can decide in O(1) whether to carry a change indicator. Each changed
// path contributes all of its ancestors, which is what makes the indicator
// propagate from a file up to the first level of the tree.
export function buildDirtyDirs(changes: GitChangeStatus[]): Set<string> {
  const dirs = new Set<string>()
  for (const change of changes) {
    const segments = renameSourcePath(change.path).split('/')
    // Drop the entry itself: only the directories above it are marked.
    segments.pop()
    let prefix = ''
    // "" is the tree root, which is not a path segment of its own.
    dirs.add(prefix)
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment
      dirs.add(prefix)
    }
  }
  return dirs
}

// statusPrefix returns the repository root relative to the data root (empty when
// they are the same path), which is what maps repository-relative status paths
// onto the data-root-relative tree. Only usable when both are absolute paths.
export function statusPrefix(dataRoot?: string, repoRoot?: string | null): string {
  if (!dataRoot || !repoRoot) {
    return ''
  }
  const base = dataRoot.replace(/\/+$/, '')
  if (repoRoot === base) {
    return ''
  }
  return repoRoot.startsWith(`${base}/`) ? repoRoot.slice(base.length + 1) : ''
}

// repoPrefix returns that same prefix for one repository. The multi-repository
// endpoint reports the relative path itself (`rel_path`), which is preferred
// because it needs no data root to be comparable; the absolute repo_root is the
// fallback for the single-repository path, where rel_path is set to repo_root.
export function repoPrefix(repo: Pick<GitRepoSummary, 'rel_path' | 'repo_root'>, dataRoot?: string): string {
  const rel = (repo.rel_path ?? '').replace(/\/+$/, '')
  if (rel && rel !== '.' && !rel.startsWith('/') && !rel.startsWith('..')) {
    return rel
  }
  return statusPrefix(dataRoot, repo.repo_root)
}

// rebaseChanges maps every repository's changes — reported relative to its own
// root — onto the data-root-relative paths the browse tree is built from.
// Without this no row would match a change unless the data root were itself the
// repository.
export function rebaseChanges(repos: GitRepoSummary[], dataRoot?: string): GitChangeStatus[] {
  const rebased: GitChangeStatus[] = []
  for (const repo of repos) {
    const prefix = repoPrefix(repo, dataRoot)
    for (const change of [...repo.staged, ...repo.unstaged, ...repo.conflicted, ...repo.untracked]) {
      rebased.push(prefix ? { ...change, path: `${prefix}/${change.path}` } : change)
    }
  }
  return rebased
}
