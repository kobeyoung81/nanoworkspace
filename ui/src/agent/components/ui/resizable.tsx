import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '../../lib/utils'

/**
 * Minimal, dependency-free resizable panel group. Panels declared with a
 * `defaultSize` hold a percentage of the group; panels without one stretch to
 * fill the remaining space. `PanelResizeHandle` drags the resizable panel
 * immediately after it. Sizes persist to localStorage when a `storageKey` is
 * provided.
 *
 * Uses Pointer Events + window listeners, which are supported in the
 * Chrome 103 floor and require no modern CSS.
 */

type PanelGroupContextValue = {
  direction: 'horizontal' | 'vertical'
  sizes: Record<number, number>
  setSize: (index: number, size: number) => void
}

const PanelGroupContext = createContext<PanelGroupContextValue | null>(null)

function usePanelGroup(): PanelGroupContextValue {
  const ctx = useContext(PanelGroupContext)
  if (!ctx) {
    throw new Error('Panel/PanelResizeHandle must be used within PanelGroup')
  }
  return ctx
}

export function PanelGroup({
  direction = 'horizontal',
  storageKey,
  className,
  children,
}: {
  direction?: 'horizontal' | 'vertical'
  storageKey?: string
  className?: string
  children: ReactNode
}) {
  const [sizes, setSizes] = useState<Record<number, number>>(() => {
    if (!storageKey) {
      return {}
    }
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        return JSON.parse(raw) as Record<number, number>
      }
    } catch {
      // ignore malformed persisted layout
    }
    return {}
  })

  useEffect(() => {
    if (!storageKey) {
      return
    }
    localStorage.setItem(storageKey, JSON.stringify(sizes))
  }, [storageKey, sizes])

  const setSize = useCallback((index: number, size: number) => {
    setSizes((current) => ({ ...current, [index]: size }))
  }, [])

  const value = useMemo(() => ({ direction, sizes, setSize }), [direction, sizes, setSize])

  return (
    <PanelGroupContext.Provider value={value}>
      <div
        className={cn('flex h-full w-full overflow-hidden', className)}
        style={{ flexDirection: direction === 'horizontal' ? 'row' : 'column' }}
      >
        {children}
      </div>
    </PanelGroupContext.Provider>
  )
}

export function Panel({
  index,
  defaultSize,
  minSize = 0,
  maxSize = 100,
  className,
  style,
  children,
}: {
  index: number
  defaultSize?: number
  minSize?: number
  maxSize?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const { direction, sizes } = usePanelGroup()
  const size = sizes[index] ?? defaultSize

  if (size !== undefined) {
    const isHorizontal = direction === 'horizontal'
    return (
      <div
        className={cn('shrink-0', className)}
        style={{
          ...style,
          flex: `0 0 ${size}%`,
          [isHorizontal ? 'minWidth' : 'minHeight']: `${minSize}%`,
          [isHorizontal ? 'maxWidth' : 'maxHeight']: `${maxSize}%`,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    )
  }

  return (
    <div className={cn('min-w-0 min-h-0', className)} style={{ ...style, flex: '1 1 0', overflow: 'hidden' }}>
      {children}
    </div>
  )
}

export function PanelResizeHandle({
  index,
  side = 'after',
  className,
  dots = false,
}: {
  /** Index of the resizable panel this handle controls. */
  index: number
  /** Which side of the handle the controlled panel sits on. */
  side?: 'after' | 'before'
  className?: string
  /** Render a thin line with a centered three-dot grip instead of a solid band. */
  dots?: boolean
}) {
  const { direction, setSize } = usePanelGroup()
  const isHorizontal = direction === 'horizontal'

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const container = handle.parentElement
    if (!container) {
      return
    }
    const rect = container.getBoundingClientRect()
    const total = isHorizontal ? rect.width : rect.height
    if (total <= 0) {
      return
    }

    // Measure the controlled panel element so the drag starts from its true
    // current size (persisted or default).
    const panelEl = (side === 'after' ? handle.nextElementSibling : handle.previousElementSibling) as HTMLElement | null
    const panelRect = panelEl ? panelEl.getBoundingClientRect() : null
    const initial = panelRect ? ((isHorizontal ? panelRect.width : panelRect.height) / total) * 100 : 0

    const start = isHorizontal ? event.clientX : event.clientY

    const onMove = (moveEvent: PointerEvent) => {
      const delta = isHorizontal ? moveEvent.clientX - start : moveEvent.clientY - start
      // Dragging a divider toward its controlled panel shrinks it: 'after'
      // panels (to the right/below) shrink on a right/down drag, 'before'
      // panels (to the left/above) grow on a right/down drag.
      const sign = side === 'after' ? -1 : 1
      setSize(index, initial + (sign * delta) / total * 100)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      className={cn(
        'group relative shrink-0 transition-colors',
        isHorizontal ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
        dots
          ? 'bg-transparent hover:bg-primary/10 active:bg-primary/20'
          : 'bg-border hover:bg-primary/20 active:bg-primary/40',
        className,
      )}
      style={{ touchAction: 'none' }}
    >
      {dots ? (
        <>
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute bg-border',
              isHorizontal ? 'left-1/2 top-0 h-full w-px -translate-x-1/2' : 'left-0 top-1/2 h-px w-full -translate-y-1/2',
            )}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full border bg-card px-1.5 py-1 shadow-sm"
          >
            <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/70" />
            <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/70" />
            <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/70" />
          </span>
        </>
      ) : null}
    </div>
  )
}
