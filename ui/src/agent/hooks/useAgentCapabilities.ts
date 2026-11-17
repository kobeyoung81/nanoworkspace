import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../lib/toast'
import { getAgentCapabilities, setAgentCapability, type AgentCapItem, type AgentCapView } from '../lib/capabilities'

// useAgentCapabilities loads an agent's capability view and exposes the
// per-item toggle handler shared by the tabbed composer settings menu. MCP is
// controlled per-server (no global master switch).
export function useAgentCapabilities(agentId: string | null) {
  const { t } = useTranslation()
  const [data, setData] = useState<AgentCapView | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!agentId) {
      return
    }
    setLoading(true)
    getAgentCapabilities(agentId)
      .then(setData)
      .catch((err: Error) => {
        toast.error(err.message || t('agent.capabilitiesMenu.loadFailed'))
      })
      .finally(() => setLoading(false))
  }, [agentId, t])

  const handleToggle = async (kind: 'mcp' | 'skill', item: AgentCapItem, checked: boolean) => {
    if (!data || busy || !agentId) {
      return
    }
    const key = `${kind}:${item.id}`
    setBusy(key)
    const next: AgentCapView = {
      ...data,
      [kind === 'mcp' ? 'mcp' : 'skills']: data[kind === 'mcp' ? 'mcp' : 'skills'].map((row) =>
        row.id === item.id ? { ...row, effective: checked, override: true } : row,
      ),
    }
    setData(next)
    try {
      await setAgentCapability(agentId, kind === 'mcp' ? 'mcp' : 'skill', item.id, checked)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('agent.capabilitiesMenu.updateFailed'))
      load()
    } finally {
      setBusy(null)
    }
  }

  return { data, loading, busy, load, toggle: handleToggle }
}
