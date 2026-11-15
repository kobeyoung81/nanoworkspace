import { useCallback, useState } from 'react'
import { Lock, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { cn } from '../../lib/utils'
import {
  ackSkill,
  type AgentCapItem,
  type McpInput,
  resetAgentCapability,
  setAgentCapability,
  type SkillInput,
} from '../../lib/capabilities'

export type LockValue = '' | 'on' | 'off'

// ToolIdentity renders the canonical tool fields used across the Capability
// Center and Agent Center: the real identifier (grep, bash, …) plus a short
// human-facing label. The long model-facing description is not shown inline;
// it is available as a hover title only.
export function ToolIdentity({
  id,
  name,
  description,
  className,
}: {
  id: string
  name?: string
  description?: string
  className?: string
}) {
  const { t } = useTranslation()
  const human = name || t(`capabilities.builtin.${id}`, { defaultValue: id })
  return (
    <div className={cn('flex min-w-0 items-baseline gap-2', className)} title={description || undefined}>
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {id}
      </code>
      <span className="truncate text-sm font-medium">{human}</span>
    </div>
  )
}

export function LockSelect({ value, onChange, disabled }: { value: LockValue; onChange: (v: LockValue) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={(v) => onChange(v as LockValue)} disabled={disabled}>
      <SelectTrigger className="h-7 w-24" aria-label={t('capabilities.lock')}>
        <SelectValue placeholder={t('capabilities.noLock')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{t('capabilities.noLock')}</SelectItem>
        <SelectItem value="on">{t('capabilities.lockOn')}</SelectItem>
        <SelectItem value="off">{t('capabilities.lockOff')}</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function ScopeBadge({ scope }: { scope: 'platform' | 'user' }) {
  const { t } = useTranslation()
  return scope === 'platform' ? <Badge variant="secondary">{t('capabilities.global')}</Badge> : <Badge>{t('capabilities.personal')}</Badge>
}

// parseHeaders accepts either a JSON object ({"Authorization":"Bearer …"}) or
// newline-separated "Name: Value" / "Name=Value" lines. It never drops input
// silently: unparseable content reports an error so the form can block Save.
function parseHeaders(raw: string): { headers: Record<string, string> | null; error: boolean } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { headers: {}, error: false }
  }
  if (trimmed.startsWith('{')) {
    try {
      const obj: unknown = JSON.parse(trimmed)
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        return { headers: null, error: true }
      }
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          out[k] = String(v)
        } else {
          return { headers: null, error: true }
        }
      }
      return { headers: out, error: false }
    } catch {
      return { headers: null, error: true }
    }
  }
  const out: Record<string, string> = {}
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue
    }
    const colon = line.indexOf(':')
    const eq = line.indexOf('=')
    const idx = colon >= 0 && eq >= 0 ? Math.min(colon, eq) : Math.max(colon, eq)
    if (idx <= 0) {
      return { headers: null, error: true }
    }
    const key = line.slice(0, idx).trim().replace(/^["']|["']$/g, '')
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (!key) {
      return { headers: null, error: true }
    }
    out[key] = val
  }
  return { headers: out, error: false }
}

// ======== MCP form dialog ========

export function McpFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  onTest,
  testing,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: McpInput
  onSubmit: (body: McpInput) => void
  onTest?: (body: McpInput) => void
  testing?: boolean
  busy?: boolean
}) {
  const { t } = useTranslation()
  const [transport, setTransport] = useState<'http' | 'sse'>(initial?.transport ?? 'http')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [headers, setHeaders] = useState(initial?.headers ? JSON.stringify(initial.headers, null, 2) : '')
  const [defaultEnabled, setDefaultEnabled] = useState<boolean>(initial?.default_enabled ?? true)
  const [locked, setLocked] = useState<LockValue>(initial?.locked ?? '')

  const reset = useCallback(() => {
    setTransport(initial?.transport ?? 'http')
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setUrl(initial?.url ?? '')
    setHeaders(initial?.headers ? JSON.stringify(initial.headers, null, 2) : '')
    setDefaultEnabled(initial?.default_enabled ?? true)
    setLocked(initial?.locked ?? '')
  }, [initial])

  const parsed = parseHeaders(headers)
  const parsedHeaders = parsed.headers
  const headerError = parsed.error ? t('capabilities.headersInvalid') : ''

  const buildBody = (): McpInput => {
    const body: McpInput = {
      name: name.trim(),
      description,
      transport,
      default_enabled: defaultEnabled,
      locked,
      url: url.trim(),
      headers: parsedHeaders ?? undefined,
    }
    if (initial?.id) {
      body.id = initial.id
    }
    return body
  }

  const submit = () => {
    const body = buildBody()
    if (!body.name || parsed.error) {
      return
    }
    onSubmit(body)
  }

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial?.id ? t('capabilities.editMcp') : t('capabilities.addMcp')}
      onReset={reset}
      onSubmit={submit}
      onTest={onTest ? () => onTest(buildBody()) : undefined}
      testing={testing}
      testDisabled={!url.trim() || parsed.error}
      busy={busy}
    >
      <div className="flex flex-col gap-3">
        <TextInput label={t('capabilities.name')} value={name} onChange={setName} required />
        <TextInput label={t('capabilities.description')} value={description} onChange={setDescription} />
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('capabilities.transport')}</span>
          <Select value={transport} onValueChange={(v) => setTransport(v as 'http' | 'sse')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="sse">SSE</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TextInput label={t('capabilities.url')} value={url} onChange={setUrl} placeholder="https://example.com/mcp" />
        <KVTextarea
          label={t('capabilities.headers')}
          value={headers}
          onChange={setHeaders}
          placeholder={'Authorization: Bearer …\nContent-Type: application/json'}
          masked
          error={headerError}
          hint={t('capabilities.headersHint')}
        />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={defaultEnabled} onCheckedChange={setDefaultEnabled} />
            {t('capabilities.defaultEnabled')}
          </label>
          <LockSelect value={locked} onChange={setLocked} />
        </div>
      </div>
    </BaseDialog>
  )
}

// ======== skill form dialog ========

export function SkillFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: SkillInput
  onSubmit: (body: SkillInput) => void
  busy?: boolean
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [files, setFiles] = useState<Record<string, string>>(initial?.files ?? { 'SKILL.md': '---\nname: \ndescription: \n---\n' })
  const [defaultEnabled, setDefaultEnabled] = useState<boolean>(initial?.default_enabled ?? true)
  const [locked, setLocked] = useState<LockValue>(initial?.locked ?? '')

  const reset = useCallback(() => {
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setFiles(initial?.files ?? { 'SKILL.md': '---\nname: \ndescription: \n---\n' })
    setDefaultEnabled(initial?.default_enabled ?? true)
    setLocked(initial?.locked ?? '')
  }, [initial])

  const addFile = () => {
    const key = `extra-${Object.keys(files).length}.md`
    setFiles({ ...files, [key]: '' })
  }

  const submit = () => {
    if (!name.trim() || !files['SKILL.md']?.trim()) {
      return
    }
    const body: SkillInput = { name: name.trim(), description, files, default_enabled: defaultEnabled, locked }
    if (initial?.id) {
      body.id = initial.id
    }
    onSubmit(body)
  }

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial?.id ? t('capabilities.editSkill') : t('capabilities.addSkill')}
      onReset={reset}
      onSubmit={submit}
      busy={busy}
    >
      <div className="flex flex-col gap-3">
        <TextInput label={t('capabilities.name')} value={name} onChange={setName} required />
        <TextInput label={t('capabilities.description')} value={description} onChange={setDescription} />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('capabilities.files')}</span>
            <Button type="button" variant="outline" size="sm" onClick={addFile}>
              {t('capabilities.addFile')}
            </Button>
          </div>
          {Object.entries(files).map(([path, content]) => (
            <div key={path} className="flex flex-col gap-1 rounded-md border p-2">
              <Input value={path} readOnly className="h-7 text-xs" />
              <Textarea value={content} onChange={(e) => setFiles({ ...files, [path]: e.target.value })} rows={5} className="min-h-0 text-xs" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={defaultEnabled} onCheckedChange={setDefaultEnabled} />
            {t('capabilities.defaultEnabled')}
          </label>
          <LockSelect value={locked} onChange={setLocked} />
        </div>
      </div>
    </BaseDialog>
  )
}

// ======== generic dialog shell ========

function BaseDialog({
  open,
  onOpenChange,
  title,
  children,
  onReset,
  onSubmit,
  onTest,
  testing,
  testDisabled,
  busy,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  children: React.ReactNode
  onReset: () => void
  onSubmit: () => void
  onTest?: () => void
  testing?: boolean
  testDisabled?: boolean
  busy?: boolean
}) {
  const { t } = useTranslation()
  const close = () => onOpenChange(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div onKeyDown={(e) => e.stopPropagation()}>{children}</div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onReset}>
            {t('common.reset')}
          </Button>
          <Button type="button" variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          {onTest ? (
            <Button type="button" variant="secondary" onClick={onTest} disabled={busy || testing || testDisabled}>
              {testing ? t('tests.testing') : t('tests.test')}
            </Button>
          ) : null}
          <Button type="button" onClick={onSubmit} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} className="font-normal" />
    </label>
  )
}

function KVTextarea({
  label,
  value,
  onChange,
  placeholder,
  masked,
  error,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  masked?: boolean
  error?: string
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      <span className="flex items-center gap-1">
        {label}
        {masked && <span className="text-xs font-normal text-muted-foreground">({`${label}`})</span>}
      </span>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className="min-h-0 font-mono text-xs" />
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      {error ? <span className="text-xs font-normal text-destructive">{error}</span> : null}
    </label>
  )
}

// ======== per-agent toggles ========

export function CapabilitiesPanel({
  agentID,
  typeID,
  data,
  onChange,
  busy,
}: {
  agentID: string
  // typeID scopes the toggles to one mode; empty targets the default mode.
  typeID?: string
  data: { builtin_tools: AgentCapItem[]; mcp: AgentCapItem[]; skills: AgentCapItem[] }
  onChange: () => void
  busy: (kind: string, ref: string) => boolean
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const toggle = async (kind: string, item: AgentCapItem, value: boolean) => {
    const key = `${kind}:${item.id}`
    setSaving((s) => ({ ...s, [key]: true }))
    try {
      await setAgentCapability(agentID, kind, item.id, value, typeID)
      onChange()
    } finally {
      setSaving((s) => ({ ...s, [key]: false }))
    }
  }

  const reset = async (kind: string, item: AgentCapItem) => {
    const key = `${kind}:${item.id}`
    setSaving((s) => ({ ...s, [key]: true }))
    try {
      await resetAgentCapability(agentID, kind, item.id, typeID)
      onChange()
    } finally {
      setSaving((s) => ({ ...s, [key]: false }))
    }
  }

  const confirmUpdate = async (item: AgentCapItem) => {
    const key = `skill:${item.id}`
    setSaving((s) => ({ ...s, [key]: true }))
    try {
      await ackSkill(item.id, item.published_version ?? item.acked_version ?? 0)
      onChange()
    } finally {
      setSaving((s) => ({ ...s, [key]: false }))
    }
  }

  const locked = (item: AgentCapItem): boolean => (item.locked ?? '') !== ''
  const disabled = (item: AgentCapItem): boolean => locked(item) || busy('', '')

  const renderGroup = (kind: string, label: string, items: AgentCapItem[]) => (
    <div className="flex flex-col gap-1">
      <h3 className="mt-2 text-sm font-semibold">{label}</h3>
      {items.length === 0 && <div className="py-2 text-xs text-muted-foreground">{t('capabilities.none')}</div>}
      {items.map((item) => {
        const savingKey = `${kind}:${item.id}`
        return (
          <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <ToolIdentity id={item.id} name={item.name} description={item.description} />
                {locked(item) && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </div>
              {item.override != null && (
                <div className="text-xs text-muted-foreground">{t('capabilities.overriddenByUser')}</div>
              )}
              {kind === 'skill' && item.update_available ? (
                <div className="text-xs text-amber-600">{t('capabilities.updateAvailable')}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {kind === 'skill' && item.update_available ? (
                <Button variant="outline" size="sm" disabled={saving[savingKey]} onClick={() => confirmUpdate(item)}>
                  {t('capabilities.confirmUpdate')}
                </Button>
              ) : null}
              {item.override != null && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={t('capabilities.resetToDefault')}
                  onClick={() => reset(kind, item)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Switch checked={item.effective} onCheckedChange={(v) => toggle(kind, item, v)} disabled={disabled(item) || saving[savingKey]} />
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      {renderGroup('builtin_tool', t('capabilities.builtinTools'), data.builtin_tools)}
      {renderGroup('mcp', t('capabilities.mcpServers'), data.mcp)}
      {renderGroup('skill', t('capabilities.skillsGroup'), data.skills)}
    </div>
  )
}