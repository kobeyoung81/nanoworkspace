import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { PermissionKey, PermissionRule } from '../../lib/agentTypes'

type Action = 'allow' | 'ask' | 'deny'

// INHERIT is the sentinel for "no explicit rule for this tool".
const INHERIT = 'inherit'

function wildcardMatch(pattern: string, s: string): boolean {
  let pi = 0
  let si = 0
  let star = -1
  let mark = 0
  while (si < s.length) {
    if (pi < pattern.length && pattern[pi] === s[si]) {
      pi++
      si++
    } else if (pi < pattern.length && pattern[pi] === '*') {
      star = pi
      mark = si
      pi++
    } else if (star !== -1) {
      pi = star + 1
      mark++
      si = mark
    } else {
      return false
    }
  }
  while (pi < pattern.length && pattern[pi] === '*') {
    pi++
  }
  return pi === pattern.length
}

// effectiveAction mirrors the runtime (last match wins; default allow).
function effectiveAction(tool: string, rules: PermissionRule[]): Action {
  let action: Action | '' = ''
  for (const r of rules) {
    if (wildcardMatch(r.pattern, tool)) {
      action = r.action
    }
  }
  return action === '' ? 'allow' : action
}

const VARIANT: Record<Action, 'success' | 'warning' | 'danger'> = {
  allow: 'success',
  ask: 'warning',
  deny: 'danger',
}

function EffectiveBadge({ action }: { action: Action }) {
  const { t } = useTranslation()
  return (
    <Badge variant={VARIANT[action]} className="shrink-0 text-[10px] uppercase tracking-wide">
      {t(`permissionRules.${action}`)}
    </Badge>
  )
}

// buildRules emits the managed rules in a deterministic order that preserves
// last-match-wins semantics: global default, then wildcard patterns, then the
// specific catalog keys, then any unmanaged rules kept verbatim.
function buildRules(
  state: Map<string, Action>,
  keys: PermissionKey[],
  preserved: PermissionRule[],
): PermissionRule[] {
  const out: PermissionRule[] = []
  const star = state.get('*')
  if (star) {
    out.push({ pattern: '*', action: star })
  }
  for (const k of keys) {
    if (k.id.includes('*')) {
      const action = state.get(k.id)
      if (action) out.push({ pattern: k.id, action })
    }
  }
  for (const k of keys) {
    if (!k.id.includes('*')) {
      const action = state.get(k.id)
      if (action) out.push({ pattern: k.id, action })
    }
  }
  out.push(...preserved)
  return out
}

function probeFor(pattern: string): string {
  if (pattern === '*') return '__default__'
  if (pattern === 'mcp__*') return 'mcp__sample'
  return pattern
}

function ActionSelect({
  value,
  allowed,
  disabled,
  onChange,
}: {
  value: string
  allowed?: Action[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const options: Action[] = ['allow', 'ask', 'deny']
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-auto min-w-[6.5rem] shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>{t('permissionRules.inherit')}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option} disabled={allowed ? !allowed.includes(option) : false}>
            {t(`permissionRules.${option}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// PolicyRow is the full-width row used for the global default and the MCP
// wildcard.
function PolicyRow({
  pattern,
  label,
  hint,
  value,
  effective,
  disabled,
  onChange,
}: {
  pattern: string
  label: string
  hint?: string
  value: string
  effective: Action
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {pattern}
          </code>
          <span className="truncate text-sm font-medium">{label}</span>
        </div>
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <EffectiveBadge action={effective} />
      <ActionSelect value={value} disabled={disabled} onChange={onChange} />
    </div>
  )
}

// PermissionCell is the compact per-tool cell used in the dense grid.
function PermissionCell({
  pattern,
  label,
  hint,
  value,
  effective,
  allowed,
  locked,
  disabled,
  onChange,
}: {
  pattern: string
  label: string
  hint?: string
  value: string
  effective: Action
  allowed?: Action[]
  locked?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border p-2.5">
      {locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {pattern}
      </code>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={hint}>
        {label}
      </span>
      <EffectiveBadge action={effective} />
      <ActionSelect value={value} allowed={allowed} disabled={disabled} onChange={onChange} />
    </div>
  )
}

export function PermissionRulesEditor({
  keys,
  value,
  onChange,
  effectiveRules,
  disabled,
}: {
  keys: PermissionKey[]
  value: PermissionRule[]
  onChange: (rules: PermissionRule[]) => void
  effectiveRules?: PermissionRule[]
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const effective = effectiveRules ?? value

  const current = useMemo(() => {
    const map = new Map<string, Action>()
    for (const rule of value) {
      map.set(rule.pattern, rule.action)
    }
    return map
  }, [value])

  const managed = useMemo(() => new Set<string>(['*', ...keys.map((k) => k.id)]), [keys])
  const preserved = useMemo(
    () => value.filter((rule) => !managed.has(rule.pattern)),
    [value, managed],
  )

  const emit = (pattern: string, action: Action | null) => {
    const next = new Map(current)
    if (action === null) {
      next.delete(pattern)
    } else {
      next.set(pattern, action)
    }
    onChange(buildRules(next, keys, preserved))
  }

  const wildcardKeys = keys.filter((k) => k.id.includes('*'))
  const plainKeys = keys.filter((k) => !k.id.includes('*'))

  const labelFor = (key: PermissionKey) =>
    t(`capabilities.builtin.${key.id}`, { defaultValue: key.id })

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('permissionRules.hint')}</p>

      <div className="overflow-hidden rounded-md border">
        <PolicyRow
          pattern="*"
          label={t('permissionRules.defaultPolicy')}
          hint={t('permissionRules.defaultPolicyHint')}
          value={current.get('*') ?? INHERIT}
          effective={effectiveAction('__default__', effective)}
          disabled={disabled}
          onChange={(v) => emit('*', v === INHERIT ? null : (v as Action))}
        />
        {wildcardKeys.map((key) => (
          <PolicyRow
            key={key.id}
            pattern={key.id}
            label={key.id === 'mcp__*' ? t('permissionRules.mcpTools') : key.id}
            hint={key.description}
            value={current.get(key.id) ?? INHERIT}
            effective={effectiveAction(probeFor(key.id), effective)}
            disabled={disabled}
            onChange={(v) => emit(key.id, v === INHERIT ? null : (v as Action))}
          />
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {plainKeys.map((key) => {
          const raw = current.get(key.id)
          const normalized = key.read_only
            ? raw === key.default_action
              ? raw
              : INHERIT
            : raw ?? INHERIT
          return (
            <PermissionCell
              key={key.id}
              pattern={key.id}
              label={labelFor(key)}
              hint={key.description}
              value={normalized}
              effective={effectiveAction(key.id, effective)}
              allowed={key.read_only ? [key.default_action] : undefined}
              locked={key.read_only}
              disabled={disabled}
              onChange={(v) => emit(key.id, v === INHERIT ? null : (v as Action))}
            />
          )
        })}
      </div>

      {preserved.length > 0 ? (
        <div className="rounded-md border border-dashed p-3">
          <p className="text-xs font-medium">{t('permissionRules.unmanaged')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('permissionRules.unmanagedHint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {preserved.map((rule) => (
              <span key={rule.pattern} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                {rule.pattern} → {rule.action}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
