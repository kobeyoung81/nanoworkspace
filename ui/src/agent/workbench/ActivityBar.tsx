import { useEffect, useRef, useState } from 'react'
import { PanelsTopLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PluginDescriptor, DockId } from './types'
import { cn } from '../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { Switch } from '../components/ui/switch'

type SizableDock = 'left' | 'right' | 'bottom'

type ActivityBarProps = {
  plugins: PluginDescriptor[]
  visible: Record<string, boolean> // pluginId -> currently visible
  onToggle: (panelId: string) => void
  dockHidden: Record<SizableDock, boolean>
  dockEmpty: Record<SizableDock, boolean>
  onToggleDock: (dock: SizableDock) => void
  className?: string
  vertical?: boolean
}

// LayoutMenu is the glide-out popover controlling show/hide of the dockable
// regions (VS Code's layout controls). Docks with no plugins are disabled.
function LayoutMenu({
  dockHidden,
  dockEmpty,
  onToggleDock,
  vertical,
}: {
  dockHidden: Record<SizableDock, boolean>
  dockEmpty: Record<SizableDock, boolean>
  onToggleDock: (dock: SizableDock) => void
  vertical: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDown = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rows: { dock: SizableDock; label: string }[] = [
    { dock: 'left', label: t('workbench.layout.left') },
    { dock: 'right', label: t('workbench.layout.right') },
    { dock: 'bottom', label: t('workbench.layout.bottom') },
  ]

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={open}
        aria-label={t('workbench.layout.title')}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          open ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <PanelsTopLeft className="h-4.5 w-4.5" />
      </button>
      {open ? (
        <div
          className={cn('absolute z-50 w-44 overflow-hidden rounded-lg border bg-card shadow-xl', vertical ? 'left-full top-0 ml-1' : 'bottom-full right-0 mb-1')}
        >
          <div className="border-b px-3 py-2 text-sm font-semibold">{t('workbench.layout.title')}</div>
          <div className="py-1">
            {rows.map((row) => (
              <div key={row.dock} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-sm text-foreground/90">{row.label}</span>
                <Switch
                  checked={!dockHidden[row.dock]}
                  disabled={dockEmpty[row.dock]}
                  onCheckedChange={() => onToggleDock(row.dock)}
                  aria-label={row.label}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ActivityBar({ plugins, visible, onToggle, dockHidden, dockEmpty, onToggleDock, className, vertical = true }: ActivityBarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-start shrink-0 gap-1',
        vertical ? 'w-12 flex-col border-r px-1 py-2' : 'h-12 w-full flex-row border-t px-3',
        className,
      )}
    >
      {plugins.map((plugin) => {
        const Icon = plugin.icon
        const active = visible[plugin.id]
        const button = (
          <button
            type="button"
            onClick={() => onToggle(plugin.id)}
            data-plugin-id={plugin.id}
            aria-pressed={active}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
              vertical ? '' : 'h-9 w-9',
              active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </button>
        )
        return (
          <Tooltip key={plugin.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side={vertical ? 'right' : 'top'}>{plugin.title}</TooltipContent>
          </Tooltip>
        )
      })}

      <div className={cn(vertical ? 'my-1 h-px w-8 bg-border' : 'mx-1 h-8 w-px bg-border')} />

      {vertical ? (
        <LayoutMenu dockHidden={dockHidden} dockEmpty={dockEmpty} onToggleDock={onToggleDock} vertical />
      ) : null}
    </div>
  )
}

export type { SizableDock, DockId }