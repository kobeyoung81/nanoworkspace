// Whether a panel has a layout box right now.
//
// The workbench keeps every plugin mounted: the ones it is not showing sit in a
// `display:none` vault or a hidden dock (see lib/domLayout). Anything that
// measures itself — a virtual list above all — has to ask this question first,
// because a measurement taken without a box is degenerate (zero heights, zero
// scroll offsets) rather than merely stale.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isLaidOut } from '../lib/domLayout'

/** How often the box is re-checked while it is missing, in ms. */
const MISSING_BOX_POLL_MS = 250

/**
 * useIsLaidOut reports whether `ref` currently has a box, re-checking on resize,
 * on a change of `activationKey` (the pane's own "this conversation is the one on
 * screen" flag, which is exact where the box is not), and on a slow poll while no
 * box is found — the vault is a `display:none` ancestor, and a box that appears
 * again is what tells the pane to measure itself and put its viewport back.
 */
export function useIsLaidOut(ref: RefObject<HTMLElement | null>, activationKey?: unknown): boolean {
  const [laidOut, setLaidOut] = useState(false)
  const rafRef = useRef(0)

  const sync = useCallback(() => {
    if (rafRef.current !== 0) {
      return
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      setLaidOut(isLaidOut(ref.current))
    })
  }, [ref])

  useLayoutEffect(sync, [sync, activationKey])

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    // Re-parenting the panel's host node (a dock move, a vault round trip) and a
    // window resize both change the box, and both are reported here.
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    window.addEventListener('resize', sync)
    sync()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      if (rafRef.current !== 0) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [ref, sync])

  useEffect(() => {
    if (laidOut) {
      return
    }
    // No box: keep asking until one shows up. Panels in the vault do not always
    // report the transition, and the pane's position is restored from the render
    // that follows this becoming true.
    const timer = window.setInterval(sync, MISSING_BOX_POLL_MS)
    return () => window.clearInterval(timer)
  }, [laidOut, sync])

  return laidOut
}
