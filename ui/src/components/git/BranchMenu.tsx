import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { ChevronDown, GitBranch, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../lib/toast'
import {
  checkout,
  createBranch,
  deleteBranch,
  fetchBranches,
  type GitBranch as GitBranchT,
  type GitRepoSummary,
} from '../../lib/gitApi'
import { cn } from '../../lib/utils'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { ConfirmDialog } from '../../ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu'
import { Input } from '../../ui/input'
import { Spinner } from '../../ui/spinner'

/**
 * BranchMenu replaces the static branch label in a repository header with a
 * menu that offers the actions the separate "Branches" tab used to provide:
 * switch to a branch, delete one (with confirmation) and create a new one.
 * Remote branches are listed read-only, which is what the tab did too.
 *
 * The branch list is fetched when the menu opens, so a panel showing many
 * repositories does not fire one request per repository up front.
 */
export function BranchMenu({
  agentId,
  repo,
  busy,
  run,
}: {
  agentId: string
  repo: GitRepoSummary
  busy: string | null
  run: (label: string, fn: () => Promise<void>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<GitBranchT[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<GitBranchT | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setBranches(await fetchBranches(agentId, repo.repo_root))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.na'))
    } finally {
      setLoading(false)
    }
  }, [agentId, repo.repo_root, t])

  // Opening loads the branch list and closing discards a half-typed name, so
  // the menu needs no effect: every transition is driven by the user.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    setCreating(false)
    setName('')
    if (next) {
      load()
    }
  }

  const doCreate = async () => {
    const branchName = name.trim()
    if (!branchName) {
      return
    }
    await run('branchCreate', async () => {
      await createBranch(agentId, repo.repo_root, branchName)
      setName('')
      setCreating(false)
      await load()
    })
  }

  const local = branches.filter((branch) => !branch.remote)
  const remote = branches.filter((branch) => branch.remote)

  return (
    // The repository header selects the repository when clicked; the menu must
    // not trigger that.
    <span className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('gitBrowser.git.branches')}
            title={t('gitBrowser.git.branches')}
            className="flex h-5 max-w-40 items-center gap-0.5 rounded px-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{repo.branch || t('gitBrowser.git.detached')}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {loading && local.length === 0 ? (
            <div className="px-2 py-1.5">
              <Spinner label={t('common.loading')} />
            </div>
          ) : null}
          {!loading && local.length === 0 ? (
            <DropdownMenuLabel className="text-[11px]">{t('gitBrowser.branches.empty')}</DropdownMenuLabel>
          ) : null}
          {local.map((branch) => (
            <div key={branch.name} className="flex items-center gap-0.5">
              <DropdownMenuItem
                className={cn('min-w-0 flex-1 gap-1.5 text-xs', branch.current && 'text-primary')}
                disabled={busy !== null || branch.current}
                onSelect={() => {
                  run('checkout', () => checkout(agentId, repo.repo_root, branch.name)).then(load)
                }}
              >
                <GitBranch
                  className={cn('h-3.5 w-3.5 shrink-0', branch.current ? 'text-primary' : 'text-muted-foreground')}
                />
                <span className="truncate">{branch.name}</span>
                {branch.current ? (
                  <Badge variant="secondary" className="ml-auto h-4 px-1 text-[9px]">
                    {t('gitBrowser.branches.current')}
                  </Badge>
                ) : null}
              </DropdownMenuItem>
              {branch.current ? null : (
                <DropdownMenuItem
                  className="h-6 w-6 shrink-0 justify-center p-0 text-muted-foreground focus:text-destructive"
                  disabled={busy !== null}
                  aria-label={t('common.delete')}
                  onSelect={() => setDeleteTarget(branch)}
                >
                  <Trash2 className="h-3 w-3" />
                </DropdownMenuItem>
              )}
            </div>
          ))}
          {remote.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px]">{t('gitBrowser.git.remotes')}</DropdownMenuLabel>
              {remote.map((branch) => (
                <DropdownMenuItem key={branch.name} disabled className="text-xs">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-info" />
                  <span className="truncate">{branch.name.replace(/^remotes\//, '')}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          {creating ? (
            <div className="flex items-center gap-1 p-1" onClick={(event) => event.stopPropagation()}>
              <Input
                autoFocus
                value={name}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') {
                    doCreate()
                  }
                }}
                placeholder={t('gitBrowser.branches.createPlaceholder')}
                className="h-6 flex-1 text-xs"
              />
              <Button
                size="sm"
                className="h-6 shrink-0 px-2 text-[11px]"
                disabled={busy !== null || !name.trim()}
                onClick={doCreate}
              >
                {t('gitBrowser.branches.create')}
              </Button>
            </div>
          ) : (
            <DropdownMenuItem
              className="text-xs"
              onSelect={(event: { preventDefault: () => void }) => {
                // Keep the menu open while the name is typed.
                event.preventDefault()
                setCreating(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('gitBrowser.branches.new')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next: boolean) => {
          if (!next) {
            setDeleteTarget(null)
          }
        }}
        title={t('gitBrowser.branches.deleteTitle')}
        description={deleteTarget ? t('gitBrowser.branches.deleteDescription', { name: deleteTarget.name }) : ''}
        confirmLabel={t('common.delete')}
        busy={busy === 'branchDelete'}
        onConfirm={async () => {
          if (!deleteTarget) {
            return
          }
          await run('branchDelete', () => deleteBranch(agentId, repo.repo_root, deleteTarget.name, true))
          setDeleteTarget(null)
          load()
        }}
      />
    </span>
  )
}
