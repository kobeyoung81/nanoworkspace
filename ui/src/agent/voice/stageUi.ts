// What the composer shows while a dictation runs, and when the batch pass runs.
//
// Both halves are pure so they can be tested without a browser: the recorder is
// the only place that knows about sockets and audio, and the rules below are the
// part that is easy to get subtly wrong.
//
// The rule the UI is built on: text under the dotted underline is not final yet.
// It stops being underlined when the last configured stage has run, and the stage
// marker at its end names the pass that is running — the same shape the polish
// brush already had.

import type { BatchTrigger } from './api'

export type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'recording'
  | 'reconnecting'
  | 'finalizing'
  | 'refining'
  | 'polishing'

export type StageUi = {
  /** The transcript on screen is provisional: show it with the dotted underline. */
  underlined: boolean
  /** The marker at the end of that text, if a pass is running or about to. */
  mark: 'batch' | 'polish' | null
  /** The ✕ (and Esc) abort the remaining passes and hand the box back. */
  cancelable: boolean
}

export type StageOptions = {
  batchEnabled: boolean
  batchTrigger: BatchTrigger
  polishEnabled: boolean
}

/**
 * voiceStageUi maps the recorder's phase onto what the composer renders.
 *
 * "finalizing" is the wait for the realtime layer's own final transcript; the
 * marker there is the pass that is about to run, so the user sees the whole
 * sequence rather than a spinner that changes meaning mid-flight.
 */
export function voiceStageUi(phase: VoicePhase, options: StageOptions): StageUi {
  switch (phase) {
    case 'idle':
      return { underlined: false, mark: null, cancelable: false }
    case 'refining':
      return { underlined: true, mark: 'batch', cancelable: true }
    case 'polishing':
      return { underlined: true, mark: options.polishEnabled ? 'polish' : null, cancelable: true }
    case 'finalizing':
      return {
        underlined: true,
        mark: options.batchEnabled && options.batchTrigger === 'always' ? 'batch' : options.polishEnabled ? 'polish' : null,
        cancelable: true,
      }
    default:
      // connecting, recording, reconnecting: the user is still talking.
      return { underlined: true, mark: null, cancelable: true }
  }
}

/** Shortest recording worth a batch pass, in milliseconds. */
const BATCH_MIN_MS = 4000

/** Characters per second below which a transcript looks like it missed speech. */
const BATCH_MIN_CHARS_PER_SECOND = 0.5

/**
 * Shortest transcript worth the rewrite pass. Two or three characters have no
 * punctuation to add and no misheard word to correct, and a cleaning prompt
 * answers such a fragment with a request for the text instead of the text —
 * which used to land in the composer as if it were the rewrite. Mirrors the
 * bus's minPolishChars: a drift between the two only costs (or saves) one call,
 * never correctness.
 */
export const POLISH_MIN_CHARS = 4

/**
 * wantsPolish reports whether the transcript is worth a rewrite. Only the
 * manual and batch tiers are paid for by default, and this pass is the one a
 * short utterance cannot benefit from at all.
 */
export function wantsPolish(text: string): boolean {
  return text.trim().length >= POLISH_MIN_CHARS
}

/**
 * wantsBatch decides whether the whole-recording pass runs for this take.
 *
 * There is no confidence score to consult — sherpa reports none — so "empty" is
 * a heuristic: a transcript that came back empty, or one that is far too short
 * for how long the user spoke, is the case worth paying an external call for.
 */
export function wantsBatch(trigger: BatchTrigger, transcript: string, elapsedMs: number): boolean {
  if (trigger === 'always') {
    return true
  }
  if (trigger === 'manual') {
    return false
  }
  const text = transcript.trim()
  if (!text) {
    return true
  }
  const seconds = elapsedMs / 1000
  if (seconds < BATCH_MIN_MS / 1000) {
    return false
  }
  return text.length < seconds * BATCH_MIN_CHARS_PER_SECOND
}
