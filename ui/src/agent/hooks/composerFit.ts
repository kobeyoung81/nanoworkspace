// Fitting the composer's toolbar into a narrow pane.
//
// The toolbar pins three groups of fixed-size controls to the composer's bottom
// band, and every one of them is `shrink-0`: when the pane is narrower than the
// row's natural width nothing yields, the row runs past the right edge and the
// send button is painted outside the composer's border. The row needs about
// 362px in Chinese and 419px in English, while the box only offers the viewport
// minus the form's 24px of padding — so a phone whose CSS viewport is 320–390px
// (an older, low-density device is exactly that) overflows.
//
// The ladder below steps the row down until the trailing controls sit inside the
// toolbar's content box again. Neither obvious alternative works here: a
// viewport breakpoint cannot decide it (the same pane needs different layouts per
// language and per browser font size, and a narrow desktop panel sees a wide
// viewport), and neither can a container query (size queries need Chrome 105+,
// while index.css still carries fallbacks for Chrome < 103/104/108).

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * The layout ladder, each step cheaper than the one before:
 * 0 full (unchanged) / 1 compact paddings, gaps and icons / 2 the instructions
 * trigger drops its label / 3 the mode toggle drops its labels too.
 * The class strings of each tier live next to the markup (AgentPage.tsx).
 */
export const COMPOSER_FIT_MAX_TIER = 3

/** Sub-pixel slack: a fraction of a pixel of overhang is rounding, not the send button leaving the box. */
export const COMPOSER_FIT_TOLERANCE_PX = 0.5

/**
 * nextComposerTier steps one tier down while the row overflows — one step at a
 * time, so the layout never jumps — and holds the current tier when it fits. It
 * never climbs back: a wider pane restarts the ladder at 0 (see the observer in
 * useComposerFit).
 */
export function nextComposerTier(current: number, overflowing: boolean): number {
  if (!overflowing) {
    return current
  }
  return Math.min(current + 1, COMPOSER_FIT_MAX_TIER)
}

/**
 * overflowsContentBox reports whether an element's right edge sits past its
 * parent's content box (the parent's padding excluded) — i.e. whether the
 * toolbar's last group is painted outside the composer, which is the symptom
 * being fixed rather than a proxy for it.
 */
export function overflowsContentBox(lastRight: number, boxRight: number, paddingRight: number): boolean {
  return lastRight > boxRight - paddingRight + COMPOSER_FIT_TOLERANCE_PX
}

/** toolbarOverflows measures the toolbar for `overflowsContentBox`. */
function toolbarOverflows(el: HTMLElement): boolean {
  const last = el.lastElementChild
  if (!last) {
    return false
  }
  const box = el.getBoundingClientRect()
  const paddingRight = Number.parseFloat(window.getComputedStyle(el).paddingRight) || 0
  return overflowsContentBox(last.getBoundingClientRect().right, box.right, paddingRight)
}

/**
 * useComposerFit measures the composer's toolbar and returns the tier to render.
 *
 * The measurement runs in a layout effect, so a tier that has to step down is
 * corrected before the browser paints: a narrowing pane never shows the
 * overflowing layout. Each pass steps one tier, so the ladder settles in at most
 * COMPOSER_FIT_MAX_TIER passes and only ever downwards.
 *
 * `contentKey` stands for everything that changes the row's natural width
 * without changing its box — the language (English labels are much wider than
 * Chinese ones) and whether the instructions group exists — which a
 * ResizeObserver cannot see.
 */
export function useComposerFit<T extends HTMLElement>(contentKey: string): {
  ref: RefObject<T | null>
  tier: number
} {
  const ref = useRef<T | null>(null)
  const [tier, setTier] = useState(0)
  // Bumped on every resize so the measurement re-runs even when it reports the
  // same tier: a shrink at the full layout has to be re-measured, not skipped.
  const [resizeTick, setResizeTick] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    const next = nextComposerTier(tier, toolbarOverflows(el))
    if (next !== tier) {
      setTier(next)
    }
  }, [tier, contentKey, resizeTick])

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    // The toolbar is `inset-x-px` inside the composer box, so its width is set by
    // the pane alone: observing it cannot feed its own measurement back.
    const observer = new ResizeObserver(() => {
      setTier(0)
      setResizeTick((tick) => tick + 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, tier }
}
