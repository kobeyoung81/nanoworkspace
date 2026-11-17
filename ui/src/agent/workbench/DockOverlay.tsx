import { PanelBottom, PanelLeft, PanelRight, Box } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { DOCK_FRACTION, type DropTarget } from './dockTarget'
import { cn } from '../lib/utils'

type DockOverlayProps = {
  target: DropTarget
  labelLeft: string
  labelRight: string
  labelBottom: string
}

// DockOverlay is a pointer-events-none feedback layer that previews where a
// dragged panel would land: translucent regions on edge docks and a 4-way
// cross in the center with the hovered quadrant highlighted.
export function DockOverlay({ target, labelLeft, labelRight, labelBottom }: DockOverlayProps) {
  const edge = target.kind === 'edge' ? target.slot : null
  const inCross = target.kind === 'cross' || target.kind === 'core'

  return (
    <div className="pointer-events-none absolute inset-0 z-40" aria-hidden>
      {edge === 'left' ? (
        <DockRegion className="left-0 top-0 h-full" style={{ width: `${DOCK_FRACTION.left * 100}%` }} label={labelLeft} />
      ) : null}
      {edge === 'right' ? (
        <DockRegion className="right-0 top-0 h-full" style={{ width: `${DOCK_FRACTION.right * 100}%` }} label={labelRight} />
      ) : null}
      {edge === 'bottom' ? (
        <DockRegion className="bottom-0 left-0 w-full" style={{ height: `${DOCK_FRACTION.bottom * 100}%` }} label={labelBottom} />
      ) : null}

      {inCross ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              <CrossQuadrant active={target.slot === 'left'}>
                <PanelLeft className="h-5 w-5" />
              </CrossQuadrant>
              <CrossQuadrant active={target.kind === 'core'}>
                <Box className="h-5 w-5" />
              </CrossQuadrant>
              <CrossQuadrant active={target.slot === 'right'}>
                <PanelRight className="h-5 w-5" />
              </CrossQuadrant>
            </div>
            <CrossQuadrant active={target.slot === 'bottom'}>
              <PanelBottom className="h-5 w-5" />
            </CrossQuadrant>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CrossQuadrant({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-md border text-foreground transition-colors',
        active ? 'border-primary bg-primary/20 text-primary' : 'border-border/70 bg-background/70 text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}

function DockRegion({ className, style, label }: { className: string; style?: CSSProperties; label: string }) {
  return (
    <div className={cn('absolute rounded-md border-2 border-primary/70 bg-primary/15', className)} style={style}>
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-background px-2 py-0.5 text-xs font-medium text-primary shadow-sm">
        {label}
      </span>
    </div>
  )
}