// The signed-in account, as the host reports it.
//
// The session belongs to the shell: it stores the token, refreshes it and decides
// what happens on sign-out. These helpers keep the call sites of the moved chat
// surface unchanged and answer from the host, which is re-read on every call so a
// refreshed token is never one render behind.

import { getHost } from '../../host'

export type Session = {
  access_token: string
  refresh_token?: string
  user_id: string
  role: string
  display_name?: string
  must_change_password?: boolean
}

export function getSession(): Session | null {
  const host = getHost()
  if (!host.userId) {
    return null
  }
  return {
    access_token: host.token,
    user_id: host.userId,
    role: host.session?.role ?? '',
    display_name: host.session?.display_name,
    must_change_password: host.session?.must_change_password,
  }
}

export function getToken(): string | null {
  try {
    return getHost().token || null
  } catch {
    return null
  }
}
