// Keeping a textarea as tall as its content, without trusting a measurement
// taken while the field has no box.
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { autoGrow } from '../lib/autoGrow'
import { isLaidOut } from '../lib/domLayout'

/**
 * useAutoGrowTextarea sizes a textarea to its content, up to `max` pixels, and
 * scrolls it beyond that.
 *
 * Measuring only means something once the browser has laid the field out: the
 * workbench keeps every panel mounted, and the ones it is not showing live in a
 * `display:none` vault, where `scrollHeight` is 0. A measurement like that is
 * dropped instead of applied — the field then falls back to its own line count
 * and minimum — and the field is measured again once it is shown, which the
 * ResizeObserver on the element reports (the same signal the composer's toolbar
 * fit relies on).
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  max: number,
): void {
  // One pass per animation frame: the observer can fire several times while a
  // panel is re-parented, and applying a height changes the box it watches.
  const rafRef = useRef(0)

  const apply = useCallback(() => {
    const el = ref.current
    if (!el) {
      return
    }
    const laidOut = isLaidOut(el)
    if (laidOut) {
      // Reset first, so deleting lines shrinks the field back.
      el.style.height = 'auto'
    }
    const next = autoGrow({ laidOut, measured: laidOut ? el.scrollHeight : 0 }, max)
    el.style.height = next.height === null ? '' : `${next.height}px`
    el.style.overflowY = next.overflowY
  }, [ref, max])

  const schedule = useCallback(() => {
    if (rafRef.current !== 0) {
      return
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      apply()
    })
  }, [apply])

  // The value is what usually changes the height, and doing it before paint
  // keeps the field from jumping a frame after the text appears.
  useLayoutEffect(() => {
    apply()
  }, [apply, value])

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    // The element may already be on screen when the hook mounts; the observer
    // only reports the transitions that follow.
    schedule()
    return () => {
      observer.disconnect()
      if (rafRef.current !== 0) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [ref, schedule])
}
