import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from '../../lib/toast'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { EmptyState } from '../ui/empty-state'
import { Badge } from '../ui/badge'
import { ModelsPanel } from '../models/ModelsPanel'
import { LockSelect, McpFormDialog, ScopeBadge, SkillFormDialog } from '../capabilities/capability-ui'
import {
  createLibrary,
  deleteLibrary,
  getLibrary,
  testLibraryMcp,
  updateLibrary,
  type McpDef,
  type McpInput,
  type SkillDef,
  type SkillInput,
} from '../../lib/capabilities'
import { TestResultDialog, type ProbeResult } from '../TestResultDialog'

// LibraryPanel is the user's personal capability library (MCP servers, skills,
// and model catalog). It is embedded as a tab of the agent configuration panel.
export function LibraryPanel() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<McpDef[]>([])
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [mcpHidden, setMcpHidden] = useState<{ open: boolean; edit?: McpDef }>({ open: false })
  const [skillHidden, setSkillHidden] = useState<{ open: boolean; edit?: SkillDef }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'mcp' | 'skills'; id: string; name: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testTitle, setTestTitle] = useState('')
  const [testResult, setTestResult] = useState<ProbeResult | null>(null)
  const [testOpen, setTestOpen] = useState(false)

  const runTest = useCallback(
    async (body: { id?: string; transport?: string; url?: string; headers?: Record<string, string> }, title: string) => {
      setTestTitle(title)
      setTestResult(null)
      setTestOpen(true)
      setTesting(true)
      try {
        setTestResult(await testLibraryMcp(body))
      } catch (err) {
        setTestResult({ ok: false, error: String(err) })
      } finally {
        setTesting(false)
      }
    },
    [],
  )

  const reload = useCallback(async () => {
    try {
      const lib = await getLibrary()
      setServers(lib.servers)
      setSkills(lib.skills)
    } catch (err) {
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const lib = await getLibrary()
        if (cancelled) {
          return
        }
        setServers(lib.servers)
        setSkills(lib.skills)
      } catch (err) {
        toast.error(String(err))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saveMcp = useCallback(
    async (body: McpInput) => {
      setBusy(true)
      try {
        if (body.id) {
          await updateLibrary('mcp', body.id, body)
        } else {
          await createLibrary('mcp', body)
        }
        toast.success(t('capabilities.saved'))
        setMcpHidden({ open: false })
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload, t],
  )

  const saveSkill = useCallback(
    async (body: SkillInput) => {
      setBusy(true)
      try {
        if (body.id) {
          await updateLibrary('skills', body.id, body)
        } else {
          await createLibrary('skills', body)
        }
        toast.success(t('capabilities.saved'))
        setSkillHidden({ open: false })
        await reload()
      } catch (err) {
        toast.error(String(err))
      } finally {
        setBusy(false)
      }
    },
    [reload, t],
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return
    }
    setBusy(true)
    try {
      await deleteLibrary(deleteTarget.kind, deleteTarget.id)
      toast.success(t('capabilities.deleted'))
      setDeleteTarget(null)
      await reload()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
  }, [deleteTarget, reload, t])

  const mcpTable = useMemo(
    () =>
      servers.length === 0 ? (
        <EmptyState title={t('capabilities.noMcp')} description={t('capabilities.noMcpHint')} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('capabilities.name')}</TableHead>
                <TableHead>{t('capabilities.scope')}</TableHead>
                <TableHead>{t('capabilities.transport')}</TableHead>
                <TableHead>{t('capabilities.lock')}</TableHead>
                <TableHead className="text-right">{t('capabilities.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.id}</div>
                  </TableCell>
                  <TableCell>
                    <ScopeBadge scope={s.scope} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.transport}</TableCell>
                  <TableCell>
                    {s.locked ? <LockSelect value={s.locked} onChange={() => {}} disabled /> : s.default_enabled ? '✓' : '–'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busy || testing} onClick={() => runTest({ id: s.id }, s.name)}>
                        {t('tests.test')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setMcpHidden({ open: true, edit: s })}>
                        {t('common.edit')}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setDeleteTarget({ kind: 'mcp', id: s.id, name: s.name })}>
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
    [servers, busy, testing, t, runTest],
  )

  const skillTable = useMemo(
    () =>
      skills.length === 0 ? (
        <EmptyState title={t('capabilities.noSkills')} description={t('capabilities.noSkillsHint')} />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('capabilities.name')}</TableHead>
                <TableHead>{t('capabilities.scope')}</TableHead>
                <TableHead>{t('capabilities.filesCount')}</TableHead>
                <TableHead className="text-right">{t('capabilities.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((s) => {
                const bundled = s.origin === 'bundled'
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {bundled && <Badge variant="secondary">{t('capabilities.bundled')}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.id}</div>
                    </TableCell>
                    <TableCell>
                      <ScopeBadge scope={s.scope} />
                    </TableCell>
                    <TableCell>{Object.keys(s.files).length}</TableCell>
                    <TableCell className="text-right">
                      {bundled ? (
                        <span className="text-xs text-muted-foreground">{t('capabilities.bundledReadOnly')}</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setSkillHidden({ open: true, edit: s })}>
                            {t('common.edit')}
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => setDeleteTarget({ kind: 'skills', id: s.id, name: s.name })}>
                            {t('common.delete')}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      ),
    [skills, t],
  )

  return (
    <div className="space-y-4">
      <Tabs defaultValue="mcp">
        <TabsList>
          <TabsTrigger value="mcp">{t('capabilities.mcpServers')}</TabsTrigger>
          <TabsTrigger value="skills">{t('capabilities.skillsGroup')}</TabsTrigger>
          <TabsTrigger value="models">{t('models.models')}</TabsTrigger>
        </TabsList>
        <TabsContent value="mcp">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setMcpHidden({ open: true })}>
                <Plus className="h-4 w-4" />
                {t('capabilities.addMcp')}
              </Button>
            </div>
            {loading ? null : mcpTable}
          </div>
        </TabsContent>
        <TabsContent value="skills">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setSkillHidden({ open: true })}>
                <Plus className="h-4 w-4" />
                {t('capabilities.addSkill')}
              </Button>
            </div>
            {loading ? null : skillTable}
          </div>
        </TabsContent>
        <TabsContent value="models">
          <ModelsPanel mode="user" />
        </TabsContent>
      </Tabs>

      <McpFormDialog
        key={`mcp:${mcpHidden.open}:${mcpHidden.edit?.id ?? 'new'}`}
        open={mcpHidden.open}
        onOpenChange={(open) => setMcpHidden({ open })}
        initial={mcpHidden.edit}
        onSubmit={saveMcp}
        onTest={(body) => runTest({ id: body.id, transport: body.transport, url: body.url, headers: body.headers }, body.name)}
        testing={testing}
        busy={busy}
      />
      <SkillFormDialog
        key={`skill:${skillHidden.open}:${skillHidden.edit?.id ?? 'new'}`}
        open={skillHidden.open}
        onOpenChange={(open) => setSkillHidden({ open })}
        initial={skillHidden.edit}
        onSubmit={saveSkill}
        busy={busy}
      />
      <TestResultDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        title={t('tests.mcpTitle', { name: testTitle })}
        result={testResult}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('capabilities.deleteTitle')}
        description={t('capabilities.deleteHint', { name: deleteTarget?.name ?? '' })}
      />
    </div>
  )
}
