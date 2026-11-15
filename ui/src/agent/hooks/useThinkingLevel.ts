import { useEffect, useState } from 'react'
import { getAgentMode, setAgentMode } from '../lib/capabilities'
import { listMyModels, type ModelEntry } from '../lib/models'
import {
  THINKING_SETTING_KEY,
  effectiveModelID,
  normalizeThinkingLevel,
  resolveThinking,
  type ResolvedThinking,
  type ThinkingLevel,
} from '../lib/thinking'

/** What is stored for one (agent, mode): a level, or '' = follow the default. */
export type ThinkingChoice = ThinkingLevel | ''

export type ThinkingLevelState = {
  /** The stored choice — what a selector writes back. */
  stored: ThinkingChoice
  /** The level actually in effect, and which layer it came from. */
  resolved: ResolvedThinking
  loading: boolean
  /** choose stores a level ('' clears it) and rolls back if the write fails. */
  choose: (level: ThinkingChoice) => Promise<void>
}

/** The three inputs the resolution needs, plus the (agent, mode) they belong to
 * so a stale read can never be shown for another agent. */
type ThinkingData = {
  key: string
  choice: ThinkingChoice
  typeDefault: string
  model: ModelEntry | null
}

/**
 * useThinkingLevel resolves one (agent, mode)'s thinking level from the same
 * inputs the runtime uses, so the composer and the user config page can both
 * show what takes effect and where it comes from — instead of a local guess that
 * may not be what the agent runs with.
 *
 * `agentID` may be null before an agent is selected: the hook then reports what
 * the model layer resolves to and writes nothing.
 */
export function useThinkingLevel(agentID: string | null, mode: string): ThinkingLevelState {
  const key = agentID ? `${agentID}:${mode}` : null
  const [data, setData] = useState<ThinkingData | null>(null)

  useEffect(() => {
    if (!agentID) return
    const pending = `${agentID}:${mode}`
    let cancelled = false
    void Promise.all([getAgentMode(agentID, mode), listMyModels()])
      .then(([view, catalog]) => {
        if (cancelled) return
        const byID = new Map<number, ModelEntry>((catalog.models ?? []).map((m) => [m.id, m]))
        setData({
          key: pending,
          // The stored choice, not the effective one: writing the effective value
          // back would freeze an inherited level into an explicit one.
          choice: normalizeThinkingLevel(view.override?.thinking),
          typeDefault: view.type?.settings?.[THINKING_SETTING_KEY] ?? '',
          model: byID.get(effectiveModelID(view.type?.models, view.override?.model_id) ?? -1) ?? null,
        })
      })
      .catch(() => {
        // A failed read must not leave the previous agent's level on screen; the
        // selector then falls back to the model layer and still writes.
        if (!cancelled) setData({ key: pending, choice: '', typeDefault: '', model: null })
      })
    return () => {
      cancelled = true
    }
  }, [agentID, mode])

  // Derived: a read for another agent is not this agent's answer.
  const current = data && data.key === key ? data : null
  const resolved = resolveThinking({
    override: current?.choice ?? '',
    typeDefault: current?.typeDefault ?? '',
    model: current?.model ?? null,
  })

  const choose = async (level: ThinkingChoice) => {
    if (!agentID || !current) return
    const previous = current.choice
    setData((d) => (d && d.key === key ? { ...d, choice: level } : d))
    try {
      await setAgentMode(agentID, mode, { thinking: level })
    } catch (err) {
      setData((d) => (d && d.key === key ? { ...d, choice: previous } : d))
      throw err
    }
  }

  return {
    stored: current?.choice ?? '',
    resolved,
    loading: agentID !== null && current === null,
    choose,
  }
}
