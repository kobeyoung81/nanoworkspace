// The window height, as a hook, for the panels that cap themselves against it.
import { useEffect, useState } from 'react'

/**
 * useViewportHeight returns window.innerHeight and re-renders when the window
 * is resized.
 *
 * The git panel caps its resizable heights at a fraction of the view (the change
 * list at 60%, the docks at 70%). Reading window.innerHeight during render does
 * not follow a resize on its own: a phone turned from portrait to landscape kept
 * the caps of the taller window, so a list could end up taller than its share of
 * the screen. dvh units would track the viewport too, but index.css still
 * carries fallbacks for browsers older than the ones that support them.
 */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight))

  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return height
}
