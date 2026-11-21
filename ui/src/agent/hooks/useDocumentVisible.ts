// Whether the browser page is actually on screen.
//
// Backgrounded tabs and phones whose app was switched away keep their React tree
// alive: timers are throttled, sockets may be frozen, and nothing about the DOM
// says "the user is not here". Reading is a user action, so "is this conversation
// being read" has to ask the document too — otherwise a message that arrives
// while the tab is in the background is marked read the moment its snapshot
// lands, and the unread badge never appears.
import { useEffect, useState } from 'react'

function visibleNow(): boolean {
  if (typeof document === 'undefined') {
    return true
  }
  return document.visibilityState === 'visible'
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(visibleNow)

  useEffect(() => {
    const sync = () => setVisible(visibleNow())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
    }
  }, [])

  return visible
}
