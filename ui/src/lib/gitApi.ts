import { getHost } from '../host'
import { classifyFileType } from './fileTypes'

/** The workspace API base and the caller's token, from the host the shell installs. */
function workspaceBase(): string {
  return getHost().api.bases.workspace
}

function workspaceToken(): string {
  return getHost().token
}

// Types mirroring the go git service response shapes.

export type GitFileEntry = {
  name: string
  is_dir: boolean
  size?: number
  modified?: number
  runtime?: boolean
}

export type GitFileListing = {
  path: string
  entries: GitFileEntry[]
}

export type GitHomeInfo = {
  user_home: string
  agent_home: string
  data_root: string
}

export type GitChangeStatus = {
  path: string
  xy: string
  staged: boolean
  is_dir?: boolean
}

export type GitStatus = {
  in_repo?: boolean
  repo_root: string
  path: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  detached: boolean
  merge_in_progress: boolean
  rebase_in_progress: boolean
  staged: GitChangeStatus[]
  unstaged: GitChangeStatus[]
  untracked: GitChangeStatus[]
  conflicted: GitChangeStatus[]
}

export type GitRepoInfo = {
  in_repo?: boolean
  repo_root: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  detached: boolean
}

export type GitLogEntry = {
  hash: string
  author_name: string
  author_email: string
  timestamp: string
  subject: string
  body?: string
  refs?: string[]
  parents: number
}

export type GitLogPage = {
  commits: GitLogEntry[]
  path: string
  has_more: boolean
}

export type GitCommitFile = {
  status: string
  path: string
}

export type GitCommitDetail = {
  hash: string
  author_name: string
  author_email: string
  timestamp: string
  subject: string
  body?: string
  refs?: string[]
  parents: number
  message: string
  files: GitCommitFile[]
  stage?: string
}

export type GitBranch = {
  name: string
  current: boolean
  remote: boolean
  tracking?: string
  behind?: number
  commit?: string
}

export type GitRemote = {
  name: string
  url: string
  push?: string
}

export type GitTag = {
  name: string
  sha?: string
}

export type GitStash = {
  ref: string
  subject: string
  sha?: string
}

export type GitShortcut = {
  id: number
  user_id: string
  agent_id: string
  path: string
  label?: string
}

// A path is "in a repo" when status succeeds; otherwise the path is browsable
// but not under version control.
export type RepoOrNone = { ok: true; status: GitStatus } | { ok: false; error: string }

function gitUrl(agentId: string, op: string, query: Record<string, string | number | boolean | undefined> = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== false) {
      params.set(key, String(value))
    }
  }
  const qs = params.toString()
  return `${workspaceBase()}/git/${encodeURIComponent(agentId)}/${op}${qs ? `?${qs}` : ''}`
}

// arr normalizes a list field that may arrive as null (older agents encoded nil
// Go slices as JSON null) so callers can safely use .length/.map.
function arr<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

async function authorizedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = workspaceToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(input, { ...init, headers })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `request failed (${response.status})`)
  }
  return response
}

async function getJson<T>(url: string): Promise<T> {
  const response = await authorizedFetch(url)
  return (await response.json()) as T
}

async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await authorizedFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await response.json()) as T
}

/** True when the path (a directory) is inside a git repository. */
export function isInRepo(status: GitStatus | null): status is GitStatus {
  return status !== null
}

// ---- Tab 1: browse + content ----

export async function fetchGitInfo(agentId: string): Promise<GitHomeInfo> {
  return getJson(gitUrl(agentId, 'info'))
}

export async function listGitDir(agentId: string, path: string): Promise<GitFileListing> {
  return getJson(gitUrl(agentId, 'list', { path }))
}

export async function suggestPaths(agentId: string, q: string, limit?: number): Promise<string[]> {
  const data = await getJson<{ matches: string[] }>(gitUrl(agentId, 'suggest', { q, limit, dirs: 1 }))
  return data.matches ?? []
}

export async function readBlob(agentId: string, file: string): Promise<string> {
  const response = await authorizedFetch(gitUrl(agentId, 'blob', { file }))
  return response.text()
}

export async function writeBlob(agentId: string, file: string, content: string): Promise<void> {
  await authorizedFetch(gitUrl(agentId, 'blob', { file }), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: content,
  })
}

// ---- Git read operations ----

export async function fetchRepoInfo(agentId: string, path: string): Promise<GitRepoInfo> {
  return getJson(gitUrl(agentId, 'repo', { path }))
}

export async function fetchGitStatus(agentId: string, path: string): Promise<GitStatus> {
  const data = await getJson<GitStatus>(gitUrl(agentId, 'status', { path }))
  return {
    ...data,
    staged: arr(data.staged),
    unstaged: arr(data.unstaged),
    untracked: arr(data.untracked),
    conflicted: arr(data.conflicted),
  }
}

/**
 * One repository discovered by the multi-repository endpoint: the shape of
 * GitStatus plus the display path and name of the repository root. repo_root is
 * absolute and is accepted verbatim by every other git operation.
 */
export type GitRepoSummary = Omit<GitStatus, 'in_repo' | 'path'> & {
  rel_path: string
  name: string
}

/**
 * Lists every repository at or under path — including nested repositories such
 * as submodules — each with its branch state and working-tree changes. One call
 * populates the whole git panel.
 */
export async function fetchRepos(agentId: string, path: string): Promise<GitRepoSummary[]> {
  const data = await getJson<{ repos: GitRepoSummary[] }>(gitUrl(agentId, 'repos', { path }))
  return arr(data.repos).map((repo) => ({
    ...repo,
    staged: arr(repo.staged),
    unstaged: arr(repo.unstaged),
    untracked: arr(repo.untracked),
    conflicted: arr(repo.conflicted),
  }))
}

export async function fetchDiff(
  agentId: string,
  path: string,
  file: string,
  staged: boolean,
  ref?: string,
): Promise<string> {
  const data = await getJson<{ diff: string }>(gitUrl(agentId, 'diff', { path, file, staged, ref }))
  return data.diff ?? ''
}

export async function fetchDiffStat(
  agentId: string,
  path: string,
  staged: boolean,
  ref?: string,
): Promise<{ path: string; added: number; deleted: number }[]> {
  const data = await getJson<{ stat: { path: string; added: number; deleted: number }[] }>(
    gitUrl(agentId, 'diffstat', { path, staged, ref }),
  )
  return data.stat ?? []
}

export async function fetchLog(agentId: string, path: string, limit: number, skip?: number, file?: string): Promise<GitLogPage> {
  const data = await getJson<GitLogPage>(gitUrl(agentId, 'log', { path, limit, skip, file }))
  return { ...data, commits: arr(data.commits) }
}

export async function fetchCommitDetail(agentId: string, path: string, sha: string): Promise<GitCommitDetail> {
  const data = await getJson<GitCommitDetail>(gitUrl(agentId, 'commit', { path, sha }))
  return { ...data, files: arr(data.files) }
}

export async function fetchBranches(agentId: string, path: string): Promise<GitBranch[]> {
  const data = await getJson<{ branches: GitBranch[] }>(gitUrl(agentId, 'branches', { path }))
  return data.branches ?? []
}

export async function fetchRemotes(agentId: string, path: string): Promise<GitRemote[]> {
  const data = await getJson<{ remotes: GitRemote[] }>(gitUrl(agentId, 'remotes', { path }))
  return data.remotes ?? []
}

export async function fetchTags(agentId: string, path: string): Promise<GitTag[]> {
  const data = await getJson<{ tags: GitTag[] }>(gitUrl(agentId, 'tags', { path }))
  return data.tags ?? []
}

export async function fetchStashes(agentId: string, path: string): Promise<GitStash[]> {
  const data = await getJson<{ stashes: GitStash[] }>(gitUrl(agentId, 'stashes', { path }))
  return data.stashes ?? []
}

export async function fetchShowBlob(agentId: string, path: string, ref: string, file: string): Promise<string> {
  const response = await authorizedFetch(gitUrl(agentId, 'show', { path, ref, file }))
  return response.text()
}

// ---- Git mutations ----

export async function stageFiles(agentId: string, path: string, files: string[]): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'stage'), { path, files })
}

export async function unstageFiles(agentId: string, path: string, files: string[]): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'unstage'), { path, files })
}

export async function discardFiles(agentId: string, path: string, files: string[]): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'discard'), { path, files })
}

export async function commitChanges(
  agentId: string,
  path: string,
  message: string,
  opts: { amend?: boolean; signoff?: boolean; all?: boolean; empty?: boolean } = {},
): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'commit'), {
    path,
    message,
    amend: opts.amend ?? false,
    signoff: opts.signoff ?? false,
    all: opts.all ?? false,
    allow_empty: opts.empty ?? false,
  })
}

export async function createBranch(agentId: string, path: string, name: string, startPoint?: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'branch'), { path, name, start_point: startPoint })
}

export async function checkout(agentId: string, path: string, ref: string, create?: boolean): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'checkout'), { path, ref, create })
}

export async function deleteBranch(agentId: string, path: string, name: string, force?: boolean): Promise<void> {
  await sendJson('DELETE', gitUrl(agentId, 'branch', { path, name, force }))
}

export async function addRemote(agentId: string, path: string, name: string, url: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'remote'), { action: 'add', path, name, url })
}

export async function removeRemote(agentId: string, path: string, name: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'remote'), { action: 'remove', path, name })
}

export async function fetchRemote(agentId: string, path: string, remote?: string, prune?: boolean): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'fetch'), { path, remote, prune })
}

export async function pushBranch(
  agentId: string,
  path: string,
  opts: { remote?: string; branch?: string; setUpstream?: boolean; force?: boolean } = {},
): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'push'), {
    path,
    remote: opts.remote,
    branch: opts.branch,
    set_upstream: opts.setUpstream ?? false,
    force: opts.force ?? false,
  })
}

export async function pullBranch(
  agentId: string,
  path: string,
  opts: { remote?: string; branch?: string; rebase?: boolean } = {},
): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'pull'), { path, remote: opts.remote, branch: opts.branch, rebase: opts.rebase })
}

export async function cloneRepo(agentId: string, url: string, dir: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'clone'), { url, dir })
}

export async function mergeBranch(agentId: string, path: string, ref: string, message?: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'merge'), { path, ref, message })
}

export async function rebaseBranch(agentId: string, path: string, ref: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'rebase'), { path, ref })
}

export async function abortMergeRebase(agentId: string, path: string, kind: 'merge' | 'rebase'): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'abort'), { path, kind })
}

export async function resolveConflict(agentId: string, path: string, file: string, strategy: 'ours' | 'theirs'): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'resolve'), { path, file, strategy })
}

export async function createTag(agentId: string, path: string, name: string, ref?: string, message?: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'tag'), { action: 'create', path, name, ref, message })
}

export async function deleteTag(agentId: string, path: string, name: string): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'tag'), { action: 'delete', path, name })
}

export async function stashAction(
  agentId: string,
  path: string,
  action: 'push' | 'apply' | 'pop' | 'drop',
  opts: { message?: string; index?: number; keep?: boolean } = {},
): Promise<void> {
  await sendJson('POST', gitUrl(agentId, 'stash'), { path, action, ...opts })
}

// ---- Shortcuts (server-side favorites) ----

export async function fetchShortcuts(agentId: string): Promise<GitShortcut[]> {
  const data = await getJson<{ shortcuts: GitShortcut[] }>(
    `${workspaceBase()}/me/shortcuts?agentID=${encodeURIComponent(agentId)}`,
  )
  return data.shortcuts ?? []
}

export async function addShortcut(agentId: string, path: string, label?: string): Promise<GitShortcut> {
  return sendJson('POST', `${workspaceBase()}/me/shortcuts`, { agent_id: agentId, path, label })
}

export async function deleteShortcut(id: number): Promise<void> {
  await sendJson('DELETE', `${workspaceBase()}/me/shortcuts/${id}`, undefined)
}

// ---- Git marker helpers (VS Code conventions) ----

export type GitMarker = {
  letter: string
  tone: 'added' | 'modified' | 'deleted' | 'untracked' | 'conflicted' | 'renamed'
}

const STATUS_TONE: Record<string, GitMarker['tone']> = {
  A: 'added',
  M: 'modified',
  T: 'modified',
  D: 'deleted',
  U: 'conflicted',
  R: 'renamed',
  C: 'renamed',
  '?': 'untracked',
}

/** Decodes an XY porcelain pair into two optional markers (index, worktree). */
export function decodeXY(xy: string): { index?: GitMarker; worktree?: GitMarker } {
  const x = xy.charAt(0)
  const y = xy.charAt(1)
  const isConflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
  const marker = (code: string): GitMarker | undefined => {
    if (code === ' ' || code === '.' || code === '?') {
      return undefined
    }
    return { letter: code, tone: isConflict ? 'conflicted' : (STATUS_TONE[code] ?? 'modified') }
  }
  return {
    index: marker(x),
    worktree: marker(y),
  }
}

/**
 * The marker shown for one change: the index code when there is one, else the
 * worktree code. git reports an untracked entry as "??", which carries neither
 * code, so those fall back to the untracked badge rather than no marker at all.
 */
export function changeMarker(change: GitChangeStatus): GitMarker {
  const { index, worktree } = decodeXY(change.xy)
  return index ?? worktree ?? { letter: '?', tone: 'untracked' }
}

/** The tone of a change status, used to color the row. */
export function statusTone(change: GitChangeStatus): GitMarker['tone'] {
  return changeMarker(change).tone
}

/** Whether an XY pair represents a conflict. */
export function isConflictXY(xy: string): boolean {
  const x = xy.charAt(0)
  const y = xy.charAt(1)
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

/** The source path of a renamed/copied entry (before any "\0=>\0" marker). */
export function renameSourcePath(path: string): string {
  const idx = path.indexOf('\0=>\0')
  return idx >= 0 ? path.slice(0, idx) : path
}

/** The destination path of a renamed/copied entry. */
export function renameDestPath(path: string): string {
  const idx = path.indexOf('\0=>\0')
  return idx >= 0 ? path.slice(idx + 4) : path
}

export function canOpenGitFile(name: string): boolean {
  return classifyFileType(name) !== null
}