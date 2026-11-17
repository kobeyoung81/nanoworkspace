import { Puzzle, Server, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Switch } from '../ui/switch'
import type { AgentCapItem, AgentCapView } from '../../lib/capabilities'

export type CapSection = 'skills' | 'mcp'

const SECTION_META: Record<CapSection, { icon: LucideIcon; titleKey: string; emptyKey: string }> = {
  skills: { icon: Puzzle, titleKey: 'composer.skills', emptyKey: 'agent.capabilitiesMenu.emptySkills' },
  mcp: { icon: Server, titleKey: 'composer.mcp', emptyKey: 'agent.capabilitiesMenu.emptyMcp' },
}

// CapabilityList renders the body of a single capability section (skills or
// MCP), shared by the composer settings tabs.
export function CapabilityList({
  data,
  section,
  busy,
  onToggle,
}: {
  data: AgentCapView | null
  section: CapSection
  busy: string | null
  onToggle: (kind: 'mcp' | 'skill', item: AgentCapItem, checked: boolean) => void
}) {
  const { t } = useTranslation()
  const meta = SECTION_META[section]
  const items = section === 'skills' ? (data?.skills ?? []) : (data?.mcp ?? [])

  const renderRow = (kind: 'mcp' | 'skill', item: AgentCapItem) => {
    const key = `${kind}:${item.id}`
    const locked = item.locked !== ''
    const forcedOn = item.locked === 'on'
    return (
      <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{item.name || item.id}</p>
          <p className="truncate text-xs text-muted-foreground">
            {item.extra?.transport ? `MCP · ${item.extra.transport}` : item.description || item.id}
          </p>
        </div>
        <Switch
          checked={forcedOn || item.effective}
          disabled={locked || busy === key}
          onCheckedChange={(checked) => onToggle(kind, item, checked)}
          aria-label={item.name || item.id}
        />
      </div>
    )
  }

  return (
    <div className="max-h-72 overflow-y-auto">
      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t(meta.emptyKey)}</div>
      ) : (
        items.map((item) => renderRow(section === 'mcp' ? 'mcp' : 'skill', item))
      )}
    </div>
  )
}
