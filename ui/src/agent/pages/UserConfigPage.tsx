import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../lib/toast'
import { Check, Loader2 } from 'lucide-react'
import { getSession, getToken } from '../lib/auth'
import { listAgents, type Agent } from '../lib/agentApi'
import { readAgentSetting, updateAgent, type AgentSettingRead } from '../lib/api'
import { CapabilitiesPanel } from '../components/capabilities/capability-ui'
import { LibraryPanel } from '../components/agent/LibraryPanel'
import { RuntimeSettingsFields } from '../components/agent/RuntimeSettingsFields'
import { applicableRuntimeKeys, type RuntimeSettings } from '../components/agent/runtimeSettings'
import {
  getAgentCapabilities,
  getAgentMode,
  listMyPermissionKeys,
  setAgentMode,
  setAgentPermissions,
  type AgentCapView,
  type PermissionKey,
  type PermissionRule,
} from '../lib/capabilities'
import { listAssignableAgentTypes, type AgentType } from '../lib/agentTypes'
import { getAgentPromptBlocks, type AgentPromptBlocks } from '../lib/promptBlocks'
import { listMyModels } from '../lib/models'
import { normalizeThinkingLevel } from '../lib/thinking'
import type { ThinkingChoice } from '../hooks/useThinkingLevel'
import { useThinkingLevel } from '../hooks/useThinkingLevel'
import { ThinkingLevelField } from '../components/agent/ThinkingLevelField'
import { PageHeader } from '../components/page-header'
import { PermissionRulesEditor } from '../components/agent/PermissionRulesEditor'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { ShortcutSettings } from '../components/composer/ShortcutSettings'
import { LanguageSettings } from '../components/user/LanguageSettings'
import { Spinner } from '../components/ui/spinner'
import { EmptyState } from '../components/ui/empty-state'

// A read-only prompt block: the shared head prompt, or one mode's switch note.
function PromptBlockBox({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {value ? (
        <textarea
          className="h-32 w-full rounded-md border bg-muted/30 p-2 font-mono text-xs"
          value={value}
          readOnly
          disabled
        />
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  )
}

// PromptFields shows what this agent actually runs with: the shared head prompt
// (build and plan read the same bytes) plus both mode switch notes. Read-only —
// user personalization goes through AGENT.md / SOUL.md.
function PromptFields({ agent, type, mode }: { agent: Agent; type: AgentType | null; mode: string }) {
  const { t } = useTranslation()
  const [blocks, setBlocks] = useState<AgentPromptBlocks | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const userID = getSession()?.user_id
    if (!agent?.id || !userID) return
    let cancelled = false
    getAgentPromptBlocks(agent.id, userID)
      .then((b) => {
        if (!cancelled) setBlocks(b)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [agent?.id])

  if (failed || !blocks) {
    // Fall back to the mode type's own prompt rather than showing nothing.
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t('userConfig.promptReadOnly')}</p>
        {type?.prompt ? (
          <textarea
            className="h-64 w-full rounded-md border bg-muted/30 p-2 font-mono text-xs"
            value={type.prompt}
            readOnly
            disabled
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('userConfig.promptUnavailable')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t('userConfig.promptReadOnly')}</p>
      <PromptBlockBox
        label={t('userConfig.promptSharedHead')}
        hint={t('userConfig.promptSharedHeadHint', {
          source: t(blocks.head_source === 'agent' ? 'userConfig.promptSourceAgent' : 'userConfig.promptSourcePlatform'),
        })}
        value={blocks.head?.content ?? ''}
      />
      {['plan', 'build'].map((id) => (
        <PromptBlockBox
          key={id}
          label={t('userConfig.promptModeNote', { mode: id })}
          hint={id === mode ? t('userConfig.promptModeNoteActive') : undefined}
          value={blocks.mode_notes[id] ?? ''}
        />
      ))}
    </div>
  )
}

// ModeModelFields selects the model for one (agent, mode) within that mode's
// allowed set, and the thinking level that mode runs at. A locked default on the
// type wins and is marked here.
function ModeModelFields({ agent, type, onSaved }: { agent: Agent; type: AgentType; onSaved: () => void }) {
  const { t } = useTranslation()
  const [modelNames, setModelNames] = useState<Record<number, string>>({})
  const [modelID, setModelID] = useState<number | undefined>(undefined)
  const [thinking, setThinking] = useState<ThinkingChoice>('')
  const thinkingState = useThinkingLevel(agent.id, type.id)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getAgentMode(agent.id, type.id), listMyModels()])
      .then(([mode, c]) => {
        if (cancelled) return
        setModelID(mode.override?.model_id || undefined)
        // The stored choice, not the effective one: writing the effective value
        // back would freeze an inherited level into an explicit one.
        setThinking(normalizeThinkingLevel(mode.override?.thinking))
        const names: Record<number, string> = {}
        for (const m of c.models ?? []) names[m.id] = m.name
        setModelNames(names)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agent.id, type.id])

  const allowed = type.models ?? []

  const save = async () => {
    setSaving(true)
    try {
      await setAgentMode(agent.id, type.id, {
        model_id: modelID ?? 0,
        clear_model_id: modelID === undefined,
        thinking,
      })
      onSaved()
      toast.success(t('userConfig.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userConfig.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-sm font-medium">{t('userConfig.modeModel')}</label>
        <p className="text-xs text-muted-foreground">{t('userConfig.modeModelHint')}</p>
        {allowed.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{t('userConfig.noModels')}</p>
        ) : (
          <Select
            value={modelID !== undefined ? String(modelID) : ''}
            onValueChange={(v) => setModelID(v ? Number(v) : undefined)}
          >
            <SelectTrigger className="mt-1.5 w-full sm:w-96">
              <SelectValue placeholder={t('userConfig.followDefault')} />
            </SelectTrigger>
            <SelectContent>
              {allowed.map((b) => (
                <SelectItem key={b.model_id} value={String(b.model_id)} disabled={b.locked}>
                  {modelNames[b.model_id] ?? `#${b.model_id}`}
                  {b.locked ? ` ${t('userConfig.locked')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <ThinkingLevelField
        choice={thinking}
        resolved={thinkingState.resolved}
        onChange={setThinking}
        disabled={thinkingState.loading}
      />
      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
          {t('userConfig.save')}
        </Button>
      </div>
    </div>
  )
}

// ModePermissionsFields edits the (agent, mode) permission overrides. Effective
// rules (type baseline + overrides) are shown alongside.
function ModePermissionsFields({ agent, type, onSaved }: { agent: Agent; type: AgentType; onSaved: () => void }) {
  const { t } = useTranslation()
  const [caps, setCaps] = useState<AgentCapView | null>(null)
  const [keys, setKeys] = useState<PermissionKey[]>([])
  const [permissions, setPermissions] = useState<PermissionRule[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getAgentCapabilities(agent.id, type.id)
      .then((c) => {
        setCaps(c)
        setPermissions(c.agent_permissions ?? [])
      })
      .catch(() => {})
    listMyPermissionKeys()
      .then((k) => setKeys(k.keys ?? []))
      .catch(() => {})
  }, [agent.id, type.id])

  const save = async () => {
    setSaving(true)
    try {
      await setAgentPermissions(agent.id, permissions, type.id)
      onSaved()
      toast.success(t('userConfig.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userConfig.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PermissionRulesEditor
        keys={keys}
        value={permissions}
        effectiveRules={caps?.permissions ?? []}
        onChange={setPermissions}
      />
      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
          {t('userConfig.save')}
        </Button>
      </div>
    </div>
  )
}

// ModeRuntimeFields edits the selected mode's runtime policy overrides. Blank
// values inherit the AgentType.
function ModeRuntimeFields({ agent, type, onSaved }: { agent: Agent; type: AgentType; onSaved: () => void }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<RuntimeSettings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAgentMode(agent.id, type.id)
      .then((mode) => {
        if (!cancelled) setSettings(mode.override?.settings ?? {})
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agent.id, type.id])

  const save = async () => {
    setSaving(true)
    try {
      await setAgentMode(agent.id, type.id, { settings })
      onSaved()
      toast.success(t('userConfig.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userConfig.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm font-medium">{t('agentSettings.title')}</div>
        <p className="text-xs text-muted-foreground">{t('agentSettings.agentDescription')}</p>
        <div className="mt-2">
          <RuntimeSettingsFields value={settings} onChange={setSettings} applicable={applicableRuntimeKeys(type)} />
        </div>
      </div>

      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
          {t('userConfig.save')}
        </Button>
      </div>
    </div>
  )
}

// CapsLoader fetches an (agent, mode) capability view. Keyed by agent+mode from
// the parent so switching remounts it fresh.
function CapsLoader({
  agentID,
  typeID,
  children,
}: {
  agentID: string
  typeID: string
  children: (state: { caps: AgentCapView | null; loading: boolean; reload: () => void }) => ReactNode
}) {
  const [caps, setCaps] = useState<AgentCapView | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    getAgentCapabilities(agentID, typeID)
      .then((view) => {
        if (!cancelled) setCaps(view)
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentID, typeID, reloadToken])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadToken((n) => n + 1)
  }, [])

  return children({ caps, loading, reload })
}

export function UserConfigPage({
  embedded = false,
  agentID,
  onAgentChange,
}: {
  embedded?: boolean
  agentID?: string | null
  onAgentChange?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [agents, setAgents] = useState<Agent[]>([])
  const [types, setTypes] = useState<AgentType[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  // When agentID is supplied (embedded plugin), the workbench owns selection;
  // otherwise the page keeps its own. Choosing an agent notifies onAgentChange
  // so the rest of the workbench follows.
  const [internalAgentID, setInternalAgentID] = useState<string | null>(null)
  const selectedAgentID = agentID ?? internalAgentID
  const [selectedMode, setSelectedMode] = useState<string>('')

  // Scheduled-task mode: what this agent overrides, and what "inherit" means on
  // this deployment (read back so the option can say it).
  const [taskMode, setTaskMode] = useState<string>('')
  const [taskModeFor, setTaskModeFor] = useState<string | null>(null)
  const [taskModeInfo, setTaskModeInfo] = useState<AgentSettingRead | null>(null)
  const [taskModeSaved, setTaskModeSaved] = useState(0)
  const [taskModeBusy, setTaskModeBusy] = useState(false)

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentID) ?? null

  // Reset the local copy when the selection changes (render-phase, so no
  // setState-in-effect).
  if (selectedAgentID !== taskModeFor) {
    setTaskModeFor(selectedAgentID)
    setTaskMode(selectedAgent?.settings?.scheduled_task_mode ?? '')
  }

  const chooseAgent = useCallback(
    (id: string) => {
      setInternalAgentID(id)
      onAgentChange?.(id)
    },
    [onAgentChange],
  )

  const modeIDs = useMemo(() => {
    const list = selectedAgent?.session_agents ?? []
    return list.length > 0 ? list : ['build', 'plan']
  }, [selectedAgent])

  // The active mode is the user's choice when valid for this agent, else the
  // agent's default session agent (derived, so no state-sync effect is needed).
  const activeMode = modeIDs.includes(selectedMode)
    ? selectedMode
    : selectedAgent?.default_agent || modeIDs[0] || 'build'

  const selectedType = types.find((ty) => ty.id === activeMode) ?? null

  const typeLabel = (id: string) => {
    if (id === 'plan') return t('userConfig.modePlan')
    if (id === 'build') return t('userConfig.modeBuild')
    return types.find((ty) => ty.id === id)?.name ?? id
  }

  const loadAgents = useCallback(() => {
    const token = getToken()
    if (!token) return
    listAgents(token)
      .then((list) => {
        setAgents(list)
        setInternalAgentID((current) => current ?? list[0]?.id ?? null)
      })
      .catch((err) => {
        setAgentsError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setAgentsLoading(false))
  }, [])

  const reloadAgents = useCallback(() => {
    setAgentsLoading(true)
    setAgentsError(null)
    loadAgents()
  }, [loadAgents])

  useEffect(() => {
    loadAgents()
    listAssignableAgentTypes()
      .then((res) => setTypes(res.types ?? []))
      .catch(() => {})
  }, [loadAgents])

  // The platform default is decoration: a failed read only drops the value from
  // the label, it never blocks the form.
  useEffect(() => {
    if (!selectedAgentID) {
      return
    }
    let ignore = false
    readAgentSetting(selectedAgentID, 'scheduled_task_mode')
      .then((info) => {
        if (!ignore) {
          setTaskModeInfo(info)
        }
      })
      .catch(() => {
        if (!ignore) {
          setTaskModeInfo(null)
        }
      })
    return () => {
      ignore = true
    }
  }, [selectedAgentID, taskModeSaved])

  const handleSaved = () => {
    loadAgents()
  }

  const setAsDefault = async () => {
    if (!selectedAgent || activeMode === selectedAgent.default_agent) return
    try {
      await updateAgent(selectedAgent.id, {
        display_name: selectedAgent.display_name,
        default_agent: activeMode,
      })
      handleSaved()
      toast.success(t('userConfig.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('userConfig.saveFailed'))
    }
  }

  const saveTaskMode = async (value: string) => {
    if (!selectedAgent) {
      return
    }
    // Radix Select cannot carry an empty value, so "inherit" is its own item.
    const stored = value === 'inherit' ? '' : value
    setTaskMode(stored)
    setTaskModeBusy(true)
    try {
      // Present = replace, {} clears: this form owns exactly one key.
      await updateAgent(selectedAgent.id, {
        display_name: selectedAgent.display_name,
        settings: stored ? { scheduled_task_mode: stored } : {},
      })
      setTaskModeSaved((n) => n + 1)
      handleSaved()
      toast.success(t('userConfig.saved'))
    } catch (err) {
      setTaskMode(selectedAgent.settings?.scheduled_task_mode ?? '')
      toast.error(err instanceof Error ? err.message : t('userConfig.saveFailed'))
    } finally {
      setTaskModeBusy(false)
    }
  }

  const taskModeEffectiveLabel = (mode: string) =>
    mode === 'plan' ? t('userConfig.taskModePlan') : t('userConfig.taskModeBuild')

  return (
    <div className="flex flex-col gap-6">
      {embedded ? null : <PageHeader title={t('userConfig.pageTitle')} subtitle={t('userConfig.subtitle')} />}

      <Tabs defaultValue="agent" className="gap-4">
        <TabsList>
          <TabsTrigger value="agent">{t('userConfig.tabAgent')}</TabsTrigger>
          <TabsTrigger value="library">{t('nav.library')}</TabsTrigger>
          <TabsTrigger value="preferences">{t('userConfig.tabPreferences')}</TabsTrigger>
        </TabsList>
        <TabsContent value="agent" className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              {agentsLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : agentsError ? (
                <div className="flex flex-col items-start gap-2 py-2">
                  <p className="text-sm text-destructive">{agentsError}</p>
                  <Button variant="outline" size="sm" onClick={() => reloadAgents()}>
                    {t('common.retry')}
                  </Button>
                </div>
              ) : agents.length === 0 ? (
                <EmptyState title={t('agent.noAgentsTitle')} description={t('userConfig.noAgents')} />
              ) : (
                <>
                  {/* First row: which agent, and which of its modes. The task mode
                      below is a per-agent setting with a hint line of its own — as a
                      third column in this row it pushed the row past the card's
                      edge, so it gets a row of its own. */}
                  <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
                    <div>
                      <label className="text-sm font-medium">{t('userConfig.selectAgent')}</label>
                      <Select value={selectedAgentID ?? ''} onValueChange={chooseAgent}>
                        <SelectTrigger className="mt-1.5 w-full sm:w-72">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.display_name || agent.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">{t('userConfig.selectMode')}</label>
                      <div className="flex items-end gap-2">
                        <Select value={activeMode} onValueChange={setSelectedMode}>
                          <SelectTrigger className="mt-1.5 w-full sm:w-72">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {modeIDs.map((id) => (
                              <SelectItem key={id} value={id}>
                                {typeLabel(id)}
                                {id === selectedAgent?.default_agent
                                  ? ` (${t('userConfig.defaultBadge')})`
                                  : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          className="mt-1.5 shrink-0"
                          disabled={!selectedAgent || activeMode === selectedAgent.default_agent}
                          onClick={setAsDefault}
                        >
                          {t('userConfig.setDefaultMode')}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">{t('userConfig.taskMode')}</label>
                    <Select
                      value={taskMode || 'inherit'}
                      onValueChange={saveTaskMode}
                      disabled={!selectedAgent || taskModeBusy}
                    >
                      <SelectTrigger className="mt-1.5 w-full sm:w-72" data-task-mode>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          {t('userConfig.taskModeInherit', {
                            value: taskModeEffectiveLabel(taskModeInfo?.platform_default ?? 'build'),
                          })}
                        </SelectItem>
                        <SelectItem value="build">{t('userConfig.taskModeBuild')}</SelectItem>
                        <SelectItem value="plan">{t('userConfig.taskModePlan')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {taskModeInfo
                        ? t('userConfig.taskModeHint', {
                            value: taskModeEffectiveLabel(taskModeInfo.effective),
                            source:
                              taskModeInfo.source === 'agent'
                                ? t('userConfig.taskModeSourceAgent')
                                : t('userConfig.taskModeSourcePlatform'),
                          })
                        : t('userConfig.taskModeHintPlain')}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {selectedAgent && activeMode ? (
            <Card>
              <CardContent className="pt-6">
                <Tabs defaultValue="prompt">
                  <TabsList>
                    <TabsTrigger value="prompt">{t('userConfig.tabPrompt')}</TabsTrigger>
                    <TabsTrigger value="runtime">{t('userConfig.tabRuntime')}</TabsTrigger>
                    <TabsTrigger value="models">{t('userConfig.tabModels')}</TabsTrigger>
                    <TabsTrigger value="permissions">{t('userConfig.tabPermissions')}</TabsTrigger>
                    <TabsTrigger value="capabilities">{t('userConfig.tabCapabilities')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="prompt">
                    <PromptFields key={`${selectedAgent.id}:${activeMode}`} agent={selectedAgent} type={selectedType} mode={activeMode} />
                  </TabsContent>
                  <TabsContent value="runtime">
                    {selectedType ? (
                      <ModeRuntimeFields
                        key={`${selectedAgent.id}:${activeMode}`}
                        agent={selectedAgent}
                        type={selectedType}
                        onSaved={handleSaved}
                      />
                    ) : null}
                  </TabsContent>
                  <TabsContent value="models">
                    {selectedType ? (
                      <ModeModelFields
                        key={`${selectedAgent.id}:${activeMode}`}
                        agent={selectedAgent}
                        type={selectedType}
                        onSaved={handleSaved}
                      />
                    ) : null}
                  </TabsContent>
                  <TabsContent value="permissions">
                    {selectedType ? (
                      <ModePermissionsFields
                        key={`${selectedAgent.id}:${activeMode}`}
                        agent={selectedAgent}
                        type={selectedType}
                        onSaved={handleSaved}
                      />
                    ) : null}
                  </TabsContent>
                  <TabsContent value="capabilities">
                    <CapsLoader
                      key={`${selectedAgent.id}:${activeMode}`}
                      agentID={selectedAgent.id}
                      typeID={activeMode}
                    >
                      {({ caps, loading, reload }) =>
                        loading ? (
                          <div className="flex justify-center py-8">
                            <Spinner />
                          </div>
                        ) : caps ? (
                          <CapabilitiesPanel
                            agentID={caps.agent_id}
                            typeID={activeMode}
                            data={caps}
                            busy={() => false}
                            onChange={reload}
                          />
                        ) : null
                      }
                    </CapsLoader>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : null}

        </TabsContent>
        <TabsContent value="library">
          <LibraryPanel />
        </TabsContent>
        {/* User-level preferences: these follow the account on this browser, not
            the selected agent, which is why the note says so. */}
        <TabsContent value="preferences">
          <Card>
            <CardHeader>
              <CardTitle>{t('userConfig.preferencesTitle')}</CardTitle>
              <CardDescription>{t('userConfig.preferencesHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <LanguageSettings />
              <ShortcutSettings />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
