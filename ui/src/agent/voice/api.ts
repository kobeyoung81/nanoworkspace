// Voice REST calls and the socket URL for dictation.
//
// The audio itself does not go through the portal's Go service: nginx proxies
// /ws/voice straight to the bus (see deploy/nginx.conf), so the browser only
// needs a same-origin socket — the same shape as the chat socket in
// lib/agentApi.ts. The one-time session id it carries is minted here first.
//
// Three tiers are configurable per platform: the realtime layer the socket
// streams into, an external batch model that re-transcribes the whole take
// (refineTranscript), and the polish pass.

import { USER_API_BASE, fetchJson, postJson } from '../lib/api'
import { getToken } from '../lib/auth'

/** BatchTrigger says when the whole-recording pass runs. */
export type BatchTrigger = 'always' | 'manual' | 'empty'

export type VoiceConfig = {
  enabled: boolean
  reason: string
  /** The platform's default dictation shortcut, e.g. "Alt+M"; empty = none. */
  shortcut: string
  max_seconds: number
  language: string
  realtime: {
    /** "local" is the platform's own ASR service, "remote" an external provider. */
    engine: 'local' | 'remote'
    model: string
    provider_name: string
    available: boolean
    /** The capture rate this tier expects; the local model wants 16000. */
    audio_rate: number
  }
  batch: {
    enabled: boolean
    trigger: BatchTrigger
    model: string
    provider_name: string
    available: boolean
  }
  polish: { enabled: boolean; model_name: string; skip_after_batch: boolean }
}

export type VoiceSession = {
  session_id: string
  expires_in: number
  ws_path: string
  max_seconds: number
  /** The rate the provider expects; the capture follows it, not the other way. */
  audio_rate: number
}

export type PolishedText = { text: string; changed: boolean; warning?: string }

export type RefinedText = { text: string; model?: string; provider_name?: string }

export const getVoiceConfig = () => fetchJson<VoiceConfig>('/voice/config', USER_API_BASE)

export const openVoiceSession = () => postJson<VoiceSession>('/voice/session', {}, USER_API_BASE)

export const polishTranscript = (text: string, signal?: AbortSignal) =>
  postJson<PolishedText>('/voice/polish', { text }, USER_API_BASE, signal)

/** voiceWsUrl is the same-origin dictation socket for a freshly minted id. */
export function voiceWsUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/ws/voice?session=${encodeURIComponent(sessionId)}`
}

/** RefineUnavailable reports that the platform has no batch tier, which is a
 * different story than a transcript that came back wrong. */
export class RefineUnavailable extends Error {}

/**
 * refineTranscript uploads one finished recording for the batch pass: a second,
 * higher-accuracy transcription of the whole take. The recorder keeps its audio
 * in memory for exactly this call, and nothing is written to disk.
 */
export async function refineTranscript(
  blob: Blob,
  filename = 'take.wav',
  signal?: AbortSignal,
): Promise<RefinedText> {
  const form = new FormData()
  form.append('audio', blob, filename)
  const token = getToken()
  const response = await fetch(`${USER_API_BASE}/voice/refine`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
    signal,
  })
  const payload = (await response.json().catch(() => null)) as
    | { text?: string; model?: string; provider_name?: string; code?: string; error?: string }
    | null
  if (!response.ok) {
    if (payload?.code === 'batch_disabled' || response.status === 503) {
      throw new RefineUnavailable(payload?.error ?? 'the batch pass is not configured')
    }
    throw new Error(payload?.error ?? `refine failed (${response.status})`)
  }
  return { text: payload?.text ?? '', model: payload?.model, provider_name: payload?.provider_name }
}

/**
 * transcribeSample uploads one finished recording against the platform ASR
 * model. It backs the admin card's "test recognition" button, for either tier
 * (target=batch exercises the batch model).
 */
export async function transcribeSample(
  blob: Blob,
  filename = 'clip.wav',
  target: 'realtime' | 'batch' = 'realtime',
): Promise<string> {
  const form = new FormData()
  form.append('audio', blob, filename)
  if (target === 'batch') {
    form.append('target', 'batch')
  }
  const token = getToken()
  const response = await fetch(`${USER_API_BASE}/voice/transcribe`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  const payload = (await response.json().catch(() => null)) as { text?: string; error?: string } | null
  if (!response.ok) {
    throw new Error(payload?.error ?? `transcribe failed (${response.status})`)
  }
  return payload?.text ?? ''
}
