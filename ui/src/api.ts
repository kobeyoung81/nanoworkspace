// The file operations, over this module's own API.
//
// The browser used to call these helpers from the shell's API module; they live
// here now and take the token and the base from the host the shell installs. The
// endpoints are this module's (`/api/v1/workspace/files/...`), so the paths below
// are relative to that base.

import { getHost } from './host'

export type FileEntry = {
  name: string
  is_dir: boolean
  size?: number
  modified?: number
  runtime?: boolean
}

export type FileListing = {
  agent_id: string
  path: string
  entries: FileEntry[]
}

/** The workspace API base, as the shell's page context names it. */
function base(): string {
  return getHost().api.bases.workspace
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${getHost().token}`, ...extra }
}

/** fileListingPath is the directory listing URL, spelled in one place. */
export function fileListingPath(agentID: string, path: string): string {
  return `/files/${encodeURIComponent(agentID)}${path ? `?path=${encodeURIComponent(path)}` : ''}`
}

export function listFiles(agentID: string, path: string): Promise<FileListing> {
  return getHost().api.get<FileListing>(fileListingPath(agentID, path), base())
}

async function contentResponse(agentID: string, path: string, init?: RequestInit): Promise<Response> {
  const query = `?path=${encodeURIComponent(path)}`
  return fetch(`${base()}/files/${encodeURIComponent(agentID)}/content${query}`, {
    ...init,
    headers: headers(init?.headers as Record<string, string> | undefined),
  })
}

export async function downloadFile(agentID: string, path: string): Promise<Blob> {
  const response = await contentResponse(agentID, path)
  if (!response.ok) {
    throw new Error(`download failed (${response.status})`)
  }
  return response.blob()
}

/** readTextFile returns null for a missing file: "never written" is a normal state. */
export async function readTextFile(agentID: string, path: string): Promise<string | null> {
  const response = await contentResponse(agentID, path)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`read failed (${response.status})`)
  }
  return response.text()
}

export async function uploadFile(agentID: string, path: string, body: Blob): Promise<void> {
  const response = await contentResponse(agentID, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  })
  if (!response.ok) {
    throw new Error(`upload failed (${response.status})`)
  }
}

export async function deleteFile(agentID: string, path: string): Promise<void> {
  const response = await contentResponse(agentID, path, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(`delete failed (${response.status})`)
  }
}

export function createFolder(agentID: string, path: string): Promise<unknown> {
  return getHost().api.post(
    `/files/${encodeURIComponent(agentID)}/mkdir?path=${encodeURIComponent(path)}`,
    {},
    base(),
  )
}

export function renameEntry(agentID: string, from: string, to: string): Promise<unknown> {
  return getHost().api.post(
    `/files/${encodeURIComponent(agentID)}/rename?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {},
    base(),
  )
}

export function copyEntry(agentID: string, from: string, to: string): Promise<unknown> {
  return getHost().api.post(
    `/files/${encodeURIComponent(agentID)}/copy?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {},
    base(),
  )
}
