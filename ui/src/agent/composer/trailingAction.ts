// Which button the composer's trailing slot shows.
//
// One slot carries four jobs: send, dictate, stop the running turn, and show
// that dictation is busy. Keeping the choice in a pure function is what makes
// the rules testable — and the rules matter, because a wrong answer here either
// hides the microphone the user was told to press or turns a live recording
// into a send button.

import type { VoicePhase } from '../voice/useRealtimeVoice'

export type TrailingAction = 'mic' | 'mic-active' | 'send' | 'stop-turn' | 'spinner'

export type TrailingActionInput = {
  /** The agent has a turn in flight (the slot shows Stop today). */
  working: boolean
  /** Where the dictation session is. */
  voice: VoicePhase
  /** The microphone can be used: browser support and a configured platform. */
  voiceAvailable: boolean
  /** Any text in the box — typed, or produced by dictation. */
  hasDraft: boolean
  /** Image attachments already staged. */
  hasAttachments: boolean
}

export function trailingAction(input: TrailingActionInput): TrailingAction {
  // A dictation session owns the slot from start to result, whatever the box
  // contains: live text must not turn the button into Send under the user's
  // finger, and a lost session that is being continued keeps the same control
  // so the user can still stop it.
  if (input.voice === 'connecting' || input.voice === 'recording' || input.voice === 'reconnecting') {
    return 'mic-active'
  }
  if (input.voice !== 'idle') {
    return 'spinner'
  }
  // Stop wins over everything: while the agent works, the slot is the only way
  // to interrupt it, and dictation waits for the next empty composer.
  if (input.working) {
    return 'stop-turn'
  }
  // The microphone only owns a fully empty composer. With an attachment staged
  // and no text, Send has to stay reachable — otherwise an image could not be
  // sent without a caption.
  if (input.voiceAvailable && !input.hasDraft && !input.hasAttachments) {
    return 'mic'
  }
  return 'send'
}
