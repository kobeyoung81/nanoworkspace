import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, Plus } from 'lucide-react'
import { toast } from '../../lib/toast'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { EmptyState } from '../ui/empty-state'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { ScopeBadge } from '../capabilities/capability-ui'
import {
  createAdminModel,
  createAdminProvider,
  createMyModel,
  createMyProvider,
  deleteAdminModel,
  deleteAdminProvider,
  deleteMyModel,
  deleteMyProvider,
  applyModelToBuiltInTypes,
  listAdminModels,
  listMyModels,
  testAdminModel,
  testAdminProvider,
  testMyModel,
  testMyProvider,
  updateAdminModel,
  updateAdminProvider,
  updateMyModel,
  updateMyProvider,
  type FetchedModel,
  type ModelCatalog,
  type ModelEntry,
  type ModelInput,
  type ModelProvider,
  type ModelTestInput,
  type ProviderInput,
  type ProviderTestInput,
} from '../../lib/models'
import { TestResultDialog, type ProbeResult } from '../TestResultDialog'

type Mode = 'admin' | 'user'

export function ModelsPanel({ mode }: { mode: Mode }) {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<ModelCatalog>({ providers: [], models: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [providerDialog, setProviderDialog] = useState<{ open: boolean; edit?: ModelProvider }>({ open: false })
  const [modelDialog, setModelDialog] = useState<{ open: boolean; edit?: ModelEntry }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'provider' | 'model'; id: number; name: string } | null>(null)
  const [applyTarget, setApplyTarget] = useState<ModelEntry | null>(null)
  const [applying, setApplying] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testTitle, setTestTitle] = useState('')
  const [testResult, setTestResult] = useState<ProbeResult | null>(null)
  const [testOpen, setTestOpen] = useState(false)

  const runProviderTest = useCallback(
    async (body: ProviderTestInput, title: string) => {
      setTestTitle(title)
      setTestResult(null)
      setTestOpen(true)
      setTesting(true)
      try {
        setTestResult(await (mode === 'admin' ? testAdminProvider(body) : testMyProvider(body)))
      } catch (err) {
        setTestResult({ ok: false, error: String(err) })
      } finally {
        setTesting(false)
      }
    },
    [mode],
  )

  const runModelTest = useCallback(
    async (body: ModelTestInput, title: string) => {
      setTestTitle(title)
      setTestResult(null)
      setTestOpen(true)
      setTesting(true)
      try {
        setTestResult(await (mode === 'admin' ? testAdminModel(body) : testMyModel(body)))
      } catch (err) {
        setTestResult({ ok: false, error: String(err) })
      } finally {
        setTesting(false)
      }
    },
    [mode],
  )

  // fetchModels asks the selected provider's /models endpoint (via the probe)
  // for the models it exposes, so the admin can pick instead of typing.
  const fetchModels = useCallback(
    async (providerId: number): Promise<FetchedModel[]> => {
      const res = await (mode === 'admin' ? testAdminProvider({ id: providerId }) : testMyProvider({ id: providerId }))
      if (!res.ok) {
        throw new Error(res.error || t('models.fetchFailed'))
      }
      return res.model_details ?? (res.models ?? []).map((id) => ({ id }))
    },
    [mode, t],
  )

  const reload = useCallback(async () => {
    try {
      const c = mode === 'admin' ? await listAdminModels() : await listMyModels()
      setCatalog(c)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const c = mode === 'admin' ? await listAdminModels() : await listMyModels()
        if (!cancelled) setCatalog(c)
      } catch (err) {
        if (!cancelled) toast.error(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode])

  const saveProvider = useCallback(
    async (body: ProviderInput) => {
      setBusy(true)
      try {
        if (providerDialog.edit) {
          if (mode === 'admin') await updateAdminProvider(providerDialog.edit.id, body)
          else await updateMyProvider(providerDialog.edit.id, body)
        } else if (mode === 'admin') await createAdminProvider(body)
        else await createMyProvider(body)
        toast.success(t('models.saved'))
        setProviderDialog({ open: false })
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [mode, providerDialog.edit, reload, t],
  )

  const saveModel = useCallback(
    async (body: ModelInput) => {
      setBusy(true)
      try {
        if (modelDialog.edit) {
          if (mode === 'admin') await updateAdminModel(modelDialog.edit.id, body)
          else await updateMyModel(modelDialog.edit.id, body)
        } else if (mode === 'admin') await createAdminModel(body)
        else await createMyModel(body)
        toast.success(t('models.saved'))
        setModelDialog({ open: false })
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [mode, modelDialog.edit, reload, t],
  )

  // applyModel hands the model to every built-in agent type. A fresh
  // installation has no per-type bindings at all, which is why its agents used
  // to start without a model; this is the one-click fix the console offers.
  const applyModel = useCallback(async () => {
    if (!applyTarget) {
      return
    }
    setApplying(true)
    try {
      const result = await applyModelToBuiltInTypes(applyTarget.id)
      toast.success(
        t('models.applyDone', {
          applied: result.applied.length,
          already: result.already.length,
          defaults: result.defaults.length,
        }),
      )
      setApplyTarget(null)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setApplying(false)
    }
  }, [applyTarget, t])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      if (deleteTarget.kind === 'provider') {
        if (mode === 'admin') await deleteAdminProvider(deleteTarget.id)
        else await deleteMyProvider(deleteTarget.id)
      } else if (mode === 'admin') await deleteAdminModel(deleteTarget.id)
      else await deleteMyModel(deleteTarget.id)
      toast.success(t('models.deleted'))
      setDeleteTarget(null)
      await reload()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }, [deleteTarget, mode, reload, t])

  const providerName = useCallback(
    (id: number) => catalog.providers.find((p) => p.id === id)?.name ?? `#${id}`,
    [catalog.providers],
  )

  const providersTable = useMemo(
    () =>
      catalog.providers.length === 0 ? (
        <EmptyState title={t('models.noProviders')} description={t('models.noProvidersHint')} />
      ) : (
        <Card>
          <Table stacked>
            <TableHeader>
              <TableRow>
                <TableHead>{t('models.name')}</TableHead>
                <TableHead>{t('models.scope')}</TableHead>
                <TableHead>{t('models.kind')}</TableHead>
                <TableHead>{t('models.baseUrl')}</TableHead>
                <TableHead className="text-right">{t('models.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalog.providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell label={t('models.name')} className="font-medium">
                    {p.name}
                  </TableCell>
                  <TableCell label={t('models.scope')}>
                    <ScopeBadge scope={p.scope} />
                  </TableCell>
                  <TableCell label={t('models.kind')} className="font-mono text-xs">
                    {p.kind}
                  </TableCell>
                  <TableCell label={t('models.baseUrl')} className="max-w-[24rem] truncate font-mono text-xs" title={p.base_url}>
                    {p.base_url}
                  </TableCell>
                  <TableCell label={t('models.actions')} className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busy || testing} onClick={() => runProviderTest({ id: p.id }, p.name)}>
                        {t('tests.test')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setProviderDialog({ open: true, edit: p })}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget({ kind: 'provider', id: p.id, name: p.name })}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ),
    [catalog.providers, busy, testing, t, runProviderTest],
  )

  const modelsTable = useMemo(
    () =>
      catalog.models.length === 0 ? (
        <EmptyState title={t('models.noModels')} description={t('models.noModelsHint')} />
      ) : (
        <Card>
          <Table stacked>
            <TableHeader>
              <TableRow>
                <TableHead>{t('models.name')}</TableHead>
                <TableHead>{t('models.provider')}</TableHead>
                <TableHead>{t('models.apiModel')}</TableHead>
                <TableHead>{t('models.contextWindow')}</TableHead>
                <TableHead>{t('models.maxOutput')}</TableHead>
                <TableHead>{t('models.thinking')}</TableHead>
                <TableHead className="text-right">{t('models.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalog.models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell label={t('models.name')} className="font-medium">
                    {m.name}
                  </TableCell>
                  <TableCell label={t('models.provider')}>{providerName(m.provider_id)}</TableCell>
                  <TableCell label={t('models.apiModel')} className="font-mono text-xs">
                    {m.model}
                  </TableCell>
                  <TableCell label={t('models.contextWindow')}>{m.context_window || '–'}</TableCell>
                  <TableCell label={t('models.maxOutput')}>{m.max_output_tokens || '–'}</TableCell>
                  <TableCell label={t('models.thinking')}>
                    {m.thinking_enabled ? m.thinking_effort || 'on' : 'off'}
                  </TableCell>
                  <TableCell label={t('models.actions')} className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busy || testing} onClick={() => runModelTest({ id: m.id }, m.name)}>
                        {t('tests.test')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setModelDialog({ open: true, edit: m })}>
                        {t('common.edit')}
                      </Button>
                      {mode === 'admin' ? (
                        <Button variant="outline" size="sm" disabled={applying} onClick={() => setApplyTarget(m)}>
                          {t('models.applyToTypes')}
                        </Button>
                      ) : null}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget({ kind: 'model', id: m.id, name: m.name })}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ),
    [catalog.models, providerName, busy, testing, applying, mode, t, runModelTest],
  )

  if (loading) {
    return null
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('models.providers')}</h2>
          <Button size="sm" onClick={() => setProviderDialog({ open: true })}>
            <Plus className="h-4 w-4" />
            {t('models.addProvider')}
          </Button>
        </div>
        {providersTable}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('models.models')}</h2>
          <Button size="sm" disabled={catalog.providers.length === 0} onClick={() => setModelDialog({ open: true })}>
            <Plus className="h-4 w-4" />
            {t('models.addModel')}
          </Button>
        </div>
        {modelsTable}
      </section>

      <ProviderDialog
        key={`provider:${providerDialog.open}:${providerDialog.edit?.id ?? 'new'}`}
        open={providerDialog.open}
        onOpenChange={(open) => setProviderDialog({ open })}
        initial={providerDialog.edit}
        onSubmit={saveProvider}
        onTest={(body) => runProviderTest(body, body.name || (providerDialog.edit?.name ?? ''))}
        testing={testing}
        busy={busy}
      />
      <ModelDialog
        key={`model:${modelDialog.open}:${modelDialog.edit?.id ?? 'new'}`}
        open={modelDialog.open}
        onOpenChange={(open) => setModelDialog({ open })}
        initial={modelDialog.edit}
        providers={catalog.providers}
        onSubmit={saveModel}
        onFetchModels={fetchModels}
        onTest={(body) => runModelTest({ id: body.id, provider_id: body.provider_id, model: body.model }, body.model || (modelDialog.edit?.name ?? ''))}
        testing={testing}
        busy={busy}
      />
      <TestResultDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        title={t('tests.modelTitle', { name: testTitle })}
        result={testResult}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('models.deleteTitle')}
        description={t('models.deleteHint', { name: deleteTarget?.name ?? '' })}
      />
      <Dialog
        open={applyTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setApplyTarget(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('models.applyToTypesTitle', { name: applyTarget?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('models.applyToTypesHint')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyTarget(null)} disabled={applying}>
              {t('common.cancel')}
            </Button>
            <Button onClick={applyModel} disabled={applying}>
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('models.applyToTypes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProviderDialog({
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
  initial?: ModelProvider
  onSubmit: (b: ProviderInput) => void
  onTest?: (b: ProviderTestInput & { name: string }) => void
  testing?: boolean
  busy?: boolean
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState(initial?.kind ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '')
  const [apiKey, setApiKey] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? t('models.editProvider') : t('models.addProvider')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('models.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('models.kind')}>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">openai</SelectItem>
                <SelectItem value="anthropic">anthropic</SelectItem>
                <SelectItem value="google">google</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('models.baseUrl')}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field label={t('models.apiKey')}>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={initial ? t('models.apiKeyKeep') : 'sk-…'}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {onTest ? (
            <Button
              variant="secondary"
              disabled={busy || testing || !baseUrl}
              onClick={() => onTest({ id: initial?.id, kind, base_url: baseUrl, api_key: apiKey, name })}
            >
              {testing ? t('tests.testing') : t('tests.test')}
            </Button>
          ) : null}
          <Button
            disabled={busy || !name || !baseUrl}
            onClick={() => onSubmit({ name, kind, base_url: baseUrl, api_key: apiKey })}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModelDialog({
  open,
  onOpenChange,
  initial,
  providers,
  onSubmit,
  onFetchModels,
  onTest,
  testing,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ModelEntry
  providers: ModelProvider[]
  onSubmit: (b: ModelInput) => void
  onFetchModels: (providerId: number) => Promise<FetchedModel[]>
  onTest?: (b: ModelTestInput) => void
  testing?: boolean
  busy?: boolean
}) {
  const { t } = useTranslation()
  const [providerId, setProviderId] = useState<number>(initial?.provider_id ?? providers[0]?.id ?? 0)
  const [name, setName] = useState(initial?.name ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [contextWindow, setContextWindow] = useState(initial?.context_window ? String(initial.context_window) : '')
  const [maxOutput, setMaxOutput] = useState(initial?.max_output_tokens ? String(initial.max_output_tokens) : '')
  const [thinking, setThinking] = useState(initial?.thinking_enabled ?? false)
  const [effort, setEffort] = useState<string>(initial?.thinking_effort || 'medium')
  const [params, setParams] = useState(initial?.params ?? '')
  const [fetching, setFetching] = useState(false)
  const [fetched, setFetched] = useState<FetchedModel[] | null>(null)

  const handleFetch = async () => {
    setFetching(true)
    setFetched(null)
    try {
      setFetched(await onFetchModels(providerId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setFetching(false)
    }
  }

  const chooseFetched = (m: FetchedModel) => {
    setModel(m.id)
    if (!name) setName(m.id)
    if (m.context_window) setContextWindow(String(m.context_window))
    if (m.max_output_tokens) setMaxOutput(String(m.max_output_tokens))
  }

  const submit = () =>
    onSubmit({
      provider_id: providerId,
      name,
      model,
      context_window: Number(contextWindow) || 0,
      max_output_tokens: Number(maxOutput) || 0,
      thinking_enabled: thinking,
      thinking_effort: thinking ? effort : '',
      params,
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? t('models.editModel') : t('models.addModel')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('models.provider')}>
            <Select
              value={String(providerId)}
              onValueChange={(v) => {
                setProviderId(Number(v))
                setFetched(null)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('models.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('models.apiModel')}>
            <div className="flex items-center gap-2">
              <Input className="min-w-0 flex-1" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fetching || busy || !providerId}
                onClick={handleFetch}
              >
                {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {t('models.fetchModels')}
              </Button>
            </div>
          </Field>
          {fetched ? (
            fetched.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('models.noFetchedModels')}</p>
            ) : (
              <Field label={t('models.fetchedModels')}>
                <Select
                  value={fetched.some((m) => m.id === model) ? model : ''}
                  onValueChange={(id) => {
                    const picked = fetched.find((m) => m.id === id)
                    if (picked) chooseFetched(picked)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('models.selectFetchedModel')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {fetched.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('models.contextWindow')}>
              <Input value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} placeholder="128000" />
            </Field>
            <Field label={t('models.maxOutput')}>
              <Input value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} placeholder="4096" />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">{t('models.thinking')}</span>
            <Switch checked={thinking} onCheckedChange={setThinking} />
          </div>
          {thinking ? (
            <Field label={t('models.thinkingEffort')}>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label={t('models.params')}>
            <Textarea
              value={params}
              onChange={(e) => setParams(e.target.value)}
              placeholder='{"temperature":0.7,"top_p":1}'
              rows={3}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {onTest ? (
            <Button
              variant="secondary"
              disabled={busy || testing || !model || !providerId}
              onClick={() => onTest({ id: initial?.id, provider_id: providerId, model })}
            >
              {testing ? t('tests.testing') : t('tests.test')}
            </Button>
          ) : null}
          <Button disabled={busy || !name || !model || !providerId} onClick={submit}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
