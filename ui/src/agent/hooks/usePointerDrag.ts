// Pointer-driven drag for the agent sidebar, following the workbench's own
// pattern (see workbench/Workbench.tsx: beginPanelDrag): capture the pointer,
// follow it on window listeners, resolve the target from the element under the
// pointer, commit on pointerup. No drag library and no HTML5 drag-and-drop —
// the latter is cancellable by any page/extension listener.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export type PointerDrag = {
  /** Caller-defined kind ("agent" or "group"). */
  kind: string
  /** The dragged item's id. */
  id: string
  /** Element the pointer is over, or null when it is not over a drop target. */
  overID: string | null
  /** For agent drags: the row the pointer is over, if any. */
  overAgentID: string | null
  /** For ordered drags: which side of the target the item would land on. */
  placement: 'before' | 'after' | null
}

export type DropResolution = {
  overID: string
  overAgentID?: string | null
  placement?: 'before' | 'after'
} | null

export function usePointerDrag({
  enabled,
  resolve,
  onCommit,
}: {
  enabled: boolean
  /** Reads the element under the pointer and turns it into a drop target. */
  resolve: (x: number, y: number, kind: string) => DropResolution
  /** Called once on pointerup when the pointer was over a target. */
  onCommit: (drag: PointerDrag) => void
}) {
  const dragRef = useRef<PointerDrag | null>(null)
  const [drag, setDrag] = useState<PointerDrag | null>(null)
  // Latest-ref: the listeners are bound once per drag, but they must see the
  // current resolver and commit callback without re-binding.
  const resolveRef = useRef(resolve)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    resolveRef.current = resolve
    commitRef.current = onCommit
  })

  const begin = useCallback(
    (kind: string, id: string, event: ReactPointerEvent) => {
      if (!enabled) {
        return
      }
      event.preventDefault()
      ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
      const initial: PointerDrag = { kind, id, overID: null, overAgentID: null, placement: null }
      dragRef.current = initial
      setDrag(initial)
    },
    [enabled],
  )

  const kind = drag?.kind ?? null
  const id = drag?.id ?? null

  useEffect(() => {
    if (!kind || !id) {
      return
    }
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current) {
        return
      }
      const resolved = resolveRef.current(event.clientX, event.clientY, current.kind)
      const next: PointerDrag = {
        ...current,
        overID: resolved?.overID ?? null,
        overAgentID: resolved?.overAgentID ?? null,
        placement: resolved?.placement ?? null,
      }
      dragRef.current = next
      setDrag(next)
    }
    const finish = (commit: boolean) => {
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (commit && current && current.overID !== null) {
        commitRef.current(current)
      }
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finish(false)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
    }
  }, [kind, id])

  return { drag, begin }
}
