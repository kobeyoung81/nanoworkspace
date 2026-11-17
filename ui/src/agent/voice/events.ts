// The dictation transcript model: provider events in, text out.
//
// One rule decides the whole experience: the provider finishes an *utterance* on
// its own — it commits when it hears a pause, without anybody releasing the
// button. A completion is therefore a segment boundary, not the end of the
// dictation; only the stop (or the configured ceiling) ends that, which is why
// `endsDictation` is a separate, explicit decision.

export type VoiceEvent =
  | { type: 'delta'; text?: string }
  | { type: 'done'; text?: string }
  | { type: 'warning'; message?: string }
  | { type: 'error'; message?: string }

/** Where the dictation is: still listening, or finalizing after a release. */
export type DictationPhase = 'recording' | 'finalizing'

export type VoiceTranscript = {
  /** Utterances the provider has already finished. */
  committed: string
  /** The utterance still being transcribed. */
  interim: string
}

export function emptyTranscript(): VoiceTranscript {
  return { committed: '', interim: '' }
}

/**
 * joinSegments appends one utterance to another the way a person would: no
 * space between CJK, one space between latin words. (Shared with the composer's
 * "append a dictation to the draft" rule so both read the same.)
 */
export function joinSegments(base: string, addition: string): string {
  const add = addition.trim()
  if (!add) {
    return base
  }
  if (!base) {
    return add
  }
  if (/\s$/.test(base) || /^[，。！？、；：）】」』,.!?;:)\]}]/.test(add)) {
    return base + add
  }
  const baseEndsWord = /[A-Za-z0-9]$/.test(base)
  const addStartsWord = /^[A-Za-z0-9]/.test(add)
  return baseEndsWord && addStartsWord ? `${base} ${add}` : base + add
}

/** transcriptText is what the composer shows. */
export function transcriptText(state: VoiceTranscript): string {
  return joinSegments(state.committed, state.interim)
}

/**
 * applyVoiceEvent folds one provider event into the transcript.
 *
 * A `done` promotes the utterance into the committed text and starts fresh, so
 * a dictation made of several utterances reads as one continuous transcript.
 */
export function applyVoiceEvent(state: VoiceTranscript, event: VoiceEvent): VoiceTranscript {
  switch (event.type) {
    case 'delta': {
      const text = event.text ?? ''
      return text ? { ...state, interim: state.interim + text } : state
    }
    case 'done': {
      const segment = (event.text ?? '').trim() || state.interim
      return { committed: joinSegments(state.committed, segment), interim: '' }
    }
    default:
      return state
  }
}

/**
 * endsDictation reports whether an event finishes the whole dictation.
 *
 * While the user is still recording the answer is always no: the provider's own
 * completion only ends an utterance. After a release the completion is exactly
 * what we are waiting for.
 */
export function endsDictation(phase: DictationPhase, event: VoiceEvent): boolean {
  return phase === 'finalizing' && event.type === 'done'
}

/** How many times one dictation may be continued on a fresh session. */
export const MAX_RECONNECTS = 5

export type LostSessionDecision = 'reconnect' | 'finalize'

/**
 * onUpstreamLost decides what happens when the provider session ends or errors
 * while the user is still dictating: continue on a new session while the
 * allowance lasts, and finalize (which always runs the polish pass) otherwise.
 */
export function onUpstreamLost(input: {
  phase: DictationPhase | 'connecting'
  reconnects: number
  max?: number
}): LostSessionDecision {
  if (input.phase === 'recording' && input.reconnects < (input.max ?? MAX_RECONNECTS)) {
    return 'reconnect'
  }
  return 'finalize'
}

/** How much longer than the transcript a rewrite may be before we reject it. */
const POLISH_SLACK_FACTOR = 3
const POLISH_SLACK_CHARS = 40

/**
 * Below this length the proportional slack above is meaningless: it would let a
 * two-character transcript be replaced by a whole sentence, which is exactly
 * what a cleaning prompt answers such a fragment with. A short utterance may
 * only gain punctuation, so it gets a ratio instead of a flat allowance.
 */
const POLISH_SHORT_SOURCE = 16
const POLISH_SHORT_RATIO = 1.5

/** polishAllowance is the longest answer still worth calling a rewrite. */
function polishAllowance(length: number): number {
  return length >= POLISH_SHORT_SOURCE
    ? length * POLISH_SLACK_FACTOR + POLISH_SLACK_CHARS
    : Math.ceil(length * POLISH_SHORT_RATIO)
}

/**
 * polishFallback decides what to keep after the polish pass: the rewritten text
 * when it is a plausible rewrite, and the raw transcript otherwise. An empty
 * answer, or one that is far longer than the input (a model that explained
 * itself instead of returning the text), must never replace what the user said.
 */
export function polishFallback(raw: string, polished: string): string {
  const candidate = polished.trim()
  const source = raw.trim()
  if (!candidate || !source) {
    return candidate || source
  }
  if (candidate.length > polishAllowance(source.length)) {
    return source
  }
  return candidate
}

/**
 * joinDraft appends a dictation result to whatever the composer already holds,
 * keeping the two apart with a space unless the existing text ends in
 * whitespace or the new text starts with punctuation the user would not want
 * separated.
 */
export function joinDraft(draft: string, addition: string): string {
  return joinSegments(draft, addition)
}
