// Where a type's stored prompt stands relative to the bundle the bus ships.
//
// Kept apart from `agentTypes.ts` (which pulls in the api client and therefore
// i18n) so the rule below stays a plain function tests can import.

export type PromptSource = 'bundled' | 'stale' | 'edited' | 'empty' | 'none'

export type AgentPromptStatus = {
  id: string
  source: PromptSource
  stored_version: number
  bundled_version: number
}

// canResetPrompt mirrors what the bus will accept: a reset needs a bundled
// prompt to restore, and offering it while the stored text already *is* that
// prompt is a button with nothing to do.
export const canResetPrompt = (status?: AgentPromptStatus): boolean =>
  !!status && status.source !== 'bundled' && status.source !== 'none'
