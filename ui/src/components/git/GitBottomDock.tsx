import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ChevronUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import { HeightResizeHandle } from '../../ui/resize-handle'
import type { GitRepoSummary } from '../../lib/gitApi'

/** A drag of a collapsed dock header expands the dock once it passes this. */
const DRAG_THRESHOLD = 8

/**
 * GitBottomDock pins one section of the git panel to its bottom edge. Collapsed
 * it is a single header strip; dragging that strip upward expands it (the height
 * follows the pointer) and the header also toggles on click. The open state and
 * the height are owned by GitTab: the change list above has to give up the
 * height, and only one dock is expanded at a time.
 */
export function GitBottomDock({
  icon: Icon,
  title,
  repo,
  count,
  open,
  height,
  min,
  max,
  onOpenChange,
  onHeightChange,
  labels,
  children,
}: {
  icon: typeof ChevronUp
  /** Section title, e.g. "Tags". */
  title: string
  /** Repository the panel belongs to; its name is shown next to the title. */
  repo: GitRepoSummary
  /** Number of entries, shown while known; null when unavailable. */
  count?: number | null
  open: boolean
  height: number
  /** Smallest allowed height, in pixels. */
  min: number
  /** Largest allowed height, in pixels. */
  max: number
  onOpenChange: (open: boolean) => void
  onHeightChange: (px: number) => void
  /** Accessible labels for the toggle and the resize handle. */
  labels: { expand: string; collapse: string; resize: string }
  children: ReactNode
}) {
  const clampHeight = Math.min(Math.max(height, min), max)
  // A drag that expands the dock is followed by a click event; this timestamp
  // lets the click handler ignore that click (and expire, so a later click is
  // never swallowed).
  const dragEndedAtRef = useRef(0)

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (open) {
      return
    }
    const startY = event.clientY
    let dragged = false
    const onMove = (moveEvent: PointerEvent) => {
      const delta = startY - moveEvent.clientY
      if (!dragged && delta < DRAG_THRESHOLD) {
        return
      }
      if (!dragged) {
        dragged = true
        onOpenChange(true)
      }
      onHeightChange(Math.min(Math.max(delta, min), max))
    }
    const onUp = () => {
      if (dragged) {
        dragEndedAtRef.current = Date.now()
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="border-t bg-card">
      {open ? (
        <HeightResizeHandle
          value={clampHeight}
          min={min}
          max={max}
          onChange={onHeightChange}
          label={labels.resize}
        />
      ) : null}
      <div
        className={cn(
          'flex h-7 select-none items-center gap-1.5 px-2',
          !open && 'cursor-row-resize',
        )}
        style={{ touchAction: 'none' }}
        onPointerDown={onHeaderPointerDown}
        onClick={() => {
          // Ignore the click that ends an expansion drag.
          if (Date.now() - dragEndedAtRef.current < 300) {
            return
          }
          onOpenChange(!open)
        }}
      >
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left"
          aria-expanded={open}
          aria-label={open ? labels.collapse : labels.expand}
          title={open ? labels.collapse : labels.expand}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-semibold">{title}</span>
        </button>
        {count == null ? null : (
          <span className="shrink-0 rounded bg-accent px-1 text-[10px] tabular-nums text-muted-foreground">{count}</span>
        )}
        <span className="truncate text-[11px] text-muted-foreground" title={repo.rel_path || repo.name}>
          {repo.name}
        </span>
        <ChevronUp
          className={cn('ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !open && 'rotate-180')}
        />
      </div>
      {open ? (
        <div className="min-h-0 overflow-hidden" style={{ height: clampHeight }}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
