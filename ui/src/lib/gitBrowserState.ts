import { useSyncExternalStore } from 'react'
import { readRawState, writeRawState } from '../lib/clientState'

// The Git Browser has two top-level tabs: the file tree and the git panel.
// They render in a footer strip inside the plugin body; the state lives in a
// tiny external store so it can be read by the body and the footer alike.
//
// The directory the panel browses is remembered per agent as well, but that
// lives in lib/agentBrowsingPath, which the file panel keeps its paths in too.

export type GitBrowserTab = 'files' | 'git'

// Read on first use rather than at import time: the account whose state this is
// only becomes known once a session exists (see lib/clientState).
let activeTab: GitBrowserTab | null = null

function storedTab(): GitBrowserTab {
  if (activeTab === null) {
    activeTab = readRawState('gitBrowser', 'tab') === 'git' ? 'git' : 'files'
  }
  return activeTab
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function setGitBrowserTab(tab: GitBrowserTab): void {
  activeTab = tab
  writeRawState('gitBrowser', 'tab', tab)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): GitBrowserTab {
  return storedTab()
}

export function useGitBrowserTab(): GitBrowserTab {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
