import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { PluginDescriptor, WorkbenchPlugin, DockId } from './types'
import type { PanelContext } from '../portal/contract'
import { portalApi } from '../portal/api'
import { portalUI } from '../portal/ui'
import type { PanelOps } from './context'
import { copyLayout, findPanelDock, loadLayout, saveLayout, setDockSize, togglePlugin } from './layout'
import { defaultMobileActive, defaultMobileTabs } from './mobileTabs'
import { canonicalPanelId } from './pluginIds'
import { ActivityBar } from './ActivityBar'
import { Dock, HostBox, DropHint } from './Dock'
import { DockOverlay } from './DockOverlay'
import { resolveDropTarget, type DropTarget } from './dockTarget'
import { StatusBar } from './StatusBar'
import { cn } from '../lib/utils'
import { readRawState, readState, writeRawState, writeState } from '../lib/clientState'
import { ErrorBoundary } from '../components/ui/error-boundary'

const DOCK_ORDER: DockId[] = ['left', 'center', 'right', 'bottom']

const DOCK_TOOLTIP: Record<DockId, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  bottom: 'bottom',
}

// StripTarget is where a dragged tab would be inserted within a dock header.
type StripTarget = { dock: DockId; index: number; caretX: number }

// PanelDrag is the live pointer-drag state: the dragged plugin, the pointer
// position, and the resolved drop feedback (a workbench dock target, a dock
// strip insertion, or an activity-bar button).
type PanelDrag = {
  panelId: string
  x: number
  y: number
  target: DropTarget | null
  strip: StripTarget | null
  activityId: string | null
}

/**
 * The mobile tab set the current version persists. Only this version counts: the
 * release that first stored the set seeded it from the desktop center dock,
 * which on a phone meant a single conversation panel — that was the wrong
 * default, so those payloads are dropped in favour of the set this version
 * ships (see mobileTabs.ts).
 */
type StoredMobileTabs = { v: 2; tabs: string[] }

function parseMobileTabs(raw: unknown): string[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const { v, tabs } = raw as { v?: unknown; tabs?: unknown }
  if (v !== 2 || !Array.isArray(tabs)) {
    return null
  }
  const ids = tabs
    .filter((id): id is string => typeof id === 'string' && id !== '')
    // A renamed plugin keeps its tab (see workbench/pluginIds).
    .map(canonicalPanelId)
  return ids.length > 0 ? ids : null
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// hostFor returns a stable DOM node per plugin id. Plugin content is portaled
// into it once; relocating the plugin merely re-parents this node (via
// HostBox), so no plugin component ever unmounts during a drag.
function useHosts() {
  const hosts = useRef(new Map<string, HTMLDivElement>())
  const hostFor = useCallback((panelId: string): HTMLDivElement => {
    let el = hosts.current.get(panelId)
    if (!el) {
      el = document.createElement('div')
      el.style.cssText = 'width:100%;height:100%;min-height:0;overflow:hidden'
      hosts.current.set(panelId, el)
    }
    return el
  }, [])
  return hostFor
}

export type WorkbenchProps = {
  plugins: WorkbenchPlugin[]
  opsRef?: MutableRefObject<PanelOps | null>
  /**
   * What a plugin from another application is allowed to know. `openPanel` is
   * added here: only the workbench can move a panel.
   */
  panelContext?: Omit<PanelContext, 'openPanel'>
  className?: string
}

export function Workbench({ plugins, opsRef, panelContext, className }: WorkbenchProps) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const [layout, setLayout] = useState(loadLayout)
  // On mobile all toggled plugins live in one tab set (the desktop dock layout
  // is never mutated, so the two views stay independent). The set itself is
  // remembered per account, so reopening the portal on a phone (or in a narrow
  // window) brings back the panels that were in use; a browser that has never
  // had one opens with the defaults from mobileTabs.ts.
  const [mobileTabs, setMobileTabsState] = useState<string[]>(() => {
    const stored = readState('mobile', 'tabs', parseMobileTabs, null)
    return stored ?? defaultMobileTabs(plugins.map((p) => p.id))
  })
  const [mobileActive, setMobileActiveState] = useState<string | null>(() => {
    const raw = readRawState('mobile', 'active')
    const stored = raw ? canonicalPanelId(raw) : null
    return stored && mobileTabs.includes(stored) ? stored : defaultMobileActive(mobileTabs)
  })
  // Both setters move together: the active panel must be one of the tabs, and
  // every change is written back.
  const setMobile = useCallback((tabs: string[], active: string | null) => {
    const nextActive = active && tabs.includes(active) ? active : (tabs[tabs.length - 1] ?? null)
    setMobileTabsState(tabs)
    setMobileActiveState(nextActive)
    writeState('mobile', 'tabs', { v: 2, tabs } satisfies StoredMobileTabs)
    writeRawState('mobile', 'active', nextActive ?? '')
  }, [])
  // Pointer-based drag state. We deliberately do NOT use HTML5 drag-and-drop:
  // any page/extension listener can cancel a dragstart via preventDefault (a
  // "share" extension did exactly that here), leaving the grab cursor stuck.
  // Pointer events are not cancellable that way and work on touch too.
  const [drag, setDrag] = useState<PanelDrag | null>(null)
  const hostFor = useHosts()
  // Panels are mounted before the workbench's own callbacks exist, and a
  // panel's context must not change identity on every render; the ref lets the
  // context stay stable while always reaching the current implementation.
  const openPanelRef = useRef<((panelId: string) => void) | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const centerColRef = useRef<HTMLDivElement>(null)
  const containerSize = useRef({ w: 0, colH: 0 })

  // Resolve the manifest into the internal plugin descriptors once per render.
  const descriptors = useMemo<PluginDescriptor[]>(
    () =>
      plugins.map((p) => ({
        id: p.id,
        icon: p.icon,
        title: p.title ?? (p.titleKey ? t(p.titleKey) : p.id),
        defaultSlot: p.defaultSlot,
        node: (
          <ErrorBoundary resetKey={p.id}>
            {p.ctxAware ? (
              <p.Component
                // A panel gets the same services a page does, plus the agent the
                // workbench is focused on and a way to open another panel.
                ctx={{
                  token: panelContext?.token ?? '',
                  userId: panelContext?.userId ?? '',
                  session: panelContext?.session ?? { user_id: panelContext?.userId ?? '' },
                  query: panelContext?.query ?? {},
                  locale: panelContext?.locale ?? '',
                  theme: panelContext?.theme ?? 'light',
                  navigate: panelContext?.navigate ?? (() => {}),
                  agentId: panelContext?.agentId,
                  t: panelContext?.t ?? ((key: string) => key),
                  ui: panelContext?.ui ?? portalUI,
                  api: panelContext?.api ?? portalApi,
                  toast: panelContext?.toast ?? { success: () => {}, info: () => {}, warning: () => {}, error: () => {} },
                  openPanel: (panelId: string) => openPanelRef.current?.(panelId),
                }}
              />
            ) : (
              <p.Component />
            )}
          </ErrorBoundary>
        ),
        HeaderActions: p.HeaderActions,
        HeaderTabs: p.HeaderTabs,
        StatusBar: p.StatusBar,
        StatusBarRight: p.StatusBarRight,
      })),
    [plugins, t, panelContext],
  )

  const defaults = useMemo(() => {
    const out: Record<string, DockId> = {}
    for (const p of descriptors) {
      out[p.id] = p.defaultSlot
    }
    return out
  }, [descriptors])

  useEffect(() => {
    saveLayout(layout)
  }, [layout])

  // Track the sizes used for drag-resize math: the row width (side handles) and
  // the center-column height (bottom handle — the bottom dock sits under the
  // center dock, not across the full width).
  useEffect(() => {
    const row = rowRef.current
    const col = centerColRef.current
    if (!row || !col) {
      return
    }
    const measure = () => {
      containerSize.current = { w: row.clientWidth, colH: col.clientHeight }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    ro.observe(col)
    return () => ro.disconnect()
  }, [isMobile])

  const handleToggle = useCallback(
    (panelId: string) => {
      // Mobile: each toggle independently adds/removes the plugin's tab.
      if (isMobile) {
        if (!mobileTabs.includes(panelId)) {
          setMobile([...mobileTabs, panelId], panelId)
        } else if (mobileActive === panelId) {
          setMobile(
            mobileTabs.filter((id) => id !== panelId),
            null,
          )
        } else {
          setMobile(mobileTabs, panelId)
        }
        return
      }
      setLayout((prev) => {
        const next = copyLayout(prev)
        togglePlugin(next, panelId, defaults)
        return next
      })
    },
    [defaults, isMobile, mobileTabs, mobileActive, setMobile],
  )

  const handleActivate = useCallback(
    (panelId: string) => {
      if (isMobile) {
        setMobile(mobileTabs, panelId)
        return
      }
      setLayout((prev) => {
        const next = copyLayout(prev)
        const dock = findPanelDock(next, panelId)
        if (dock) {
          next.docks[dock].active = panelId
        }
        return next
      })
    },
    [isMobile, mobileTabs, setMobile],
  )

  const handleClose = useCallback(
    (panelId: string) => {
      if (isMobile) {
        const next = mobileTabs.filter((id) => id !== panelId)
        setMobile(next, mobileActive === panelId ? null : mobileActive)
        return
      }
      setLayout((prev) => {
        const next = copyLayout(prev)
        const current = findPanelDock(next, panelId)
        if (current) {
          next.docks[current].tabs = next.docks[current].tabs.filter((id) => id !== panelId)
          if (next.docks[current].active === panelId) {
            next.docks[current].active = next.docks[current].tabs[0] ?? null
          }
        }
        return next
      })
    },
    [isMobile, mobileTabs, mobileActive, setMobile],
  )

  // Show/hide an entire dockable region. Plugins keep their tags (they stay
  // mounted in the vault) and reappear when the dock is shown again.
  const toggleDock = useCallback((dock: 'left' | 'right' | 'bottom') => {
    setLayout((prev) => {
      const next = copyLayout(prev)
      next.hiddenSlots[dock] = !next.hiddenSlots[dock]
      return next
    })
  }, [])

  // Public plugin operations exposed through opsRef so plugins (via context)
  // can control the workbench (open/close/activate any plugin).
  const openPanel = useCallback(
    (panelId: string) => {
      if (isMobile) {
        setMobile(mobileTabs.includes(panelId) ? mobileTabs : [...mobileTabs, panelId], panelId)
        return
      }
      setLayout((prev) => {
        const next = copyLayout(prev)
        const dock = findPanelDock(next, panelId)
        if (dock) {
          next.docks[dock].active = panelId
          return next
        }
        const target = next.lastSlot[panelId] ?? defaults[panelId]
        next.docks[target].tabs.push(panelId)
        next.docks[target].active = panelId
        next.lastSlot[panelId] = target
        return next
      })
    },
    [defaults, isMobile, mobileTabs, setMobile],
  )

  useEffect(() => {
    openPanelRef.current = openPanel
  }, [openPanel])

  const activatePanel = useCallback(
    (panelId: string) => {
      if (isMobile) {
        setMobile(mobileTabs, panelId)
        return
      }
      setLayout((prev) => {
        const next = copyLayout(prev)
        const dock = findPanelDock(next, panelId)
        if (dock) {
          next.docks[dock].active = panelId
        }
        return next
      })
    },
    [isMobile, mobileTabs, setMobile],
  )

  useEffect(() => {
    if (!opsRef) {
      return
    }
    opsRef.current = { openPanel, closePanel: handleClose, activatePanel }
    return () => {
      opsRef.current = null
    }
  }, [opsRef, openPanel, handleClose, activatePanel])

  const handleDrop = useCallback(
    (panelId: string, toDock: DockId, index?: number) => {
      if (isMobile) {
        setMobile(mobileTabs.includes(panelId) ? mobileTabs : [...mobileTabs, panelId], panelId)
        return
      }
      setLayout((prev) => {
        const next = copyLayout(prev)
        const current = findPanelDock(next, panelId)
        const fromIndex = current ? next.docks[current].tabs.indexOf(panelId) : -1
        if (current) {
          next.docks[current].tabs = next.docks[current].tabs.filter((id) => id !== panelId)
          if (next.docks[current].active === panelId) {
            next.docks[current].active = next.docks[current].tabs[0] ?? null
          }
        }
        const target = next.docks[toDock]
        // When reordering inside the same dock the dragged tab is removed first,
        // so an insertion point after it shifts left by one.
        let at = index ?? target.tabs.length
        if (current === toDock && fromIndex >= 0 && fromIndex < at) {
          at -= 1
        }
        at = Math.max(0, Math.min(at, target.tabs.length))
        target.tabs.splice(at, 0, panelId)
        target.active = panelId
        next.lastSlot[panelId] = toDock
        if (toDock !== 'center') {
          next.hiddenSlots[toDock] = false
        }
        return next
      })
    },
    [isMobile, mobileTabs, setMobile],
  )

  // ---- Pointer-based drag & drop (VS Code style overlay docking) ----
  // HTML5 drag-and-drop is trivially cancelled by any page/extension listener
  // calling preventDefault on dragstart (a browser "share" extension did this,
  // which aborted the drag and left the grab cursor stuck). We drive docking
  // entirely with pointer events instead: pointermove resolves a target under
  // the pointer, pointerup commits it, Escape/pointercancel aborts.
  const beginPanelDrag = useCallback((panelId: string, e: ReactPointerEvent) => {
    if (e.button !== 0) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    // Capture so pointermove/up keep flowing to us even over plugin content
    // (xterm canvases, etc.) for the duration of the drag.
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      // capture is best-effort
    }
    setDrag({ panelId, x: e.clientX, y: e.clientY, target: null, strip: null, activityId: null })
  }, [])

  const dragPanelId = drag?.panelId
  useEffect(() => {
    if (!dragPanelId) {
      return
    }
    let raf = 0
    const latest = { x: 0, y: 0 }
    // The resolved feedback for the current pointer position, captured per
    // effect run so pointerup can commit without reading React state.
    let resolved: { target: DropTarget | null; strip: StripTarget | null; activityId: string | null } = {
      target: null,
      strip: null,
      activityId: null,
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    const compute = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const stripEl = el?.closest('[data-tab-strip]') as HTMLElement | null
      const activityEl = el?.closest('[data-plugin-id]') as HTMLElement | null
      let target: DropTarget | null = null
      let strip: StripTarget | null = null
      let activityId: string | null = null
      if (stripEl) {
        const dock = stripEl.dataset.dock as DockId | undefined
        if (dock) {
          const stripRect = stripEl.getBoundingClientRect()
          const tagEl = el?.closest('[data-tab-index]') as HTMLElement | null
          if (tagEl) {
            const tagRect = tagEl.getBoundingClientRect()
            const before = x < tagRect.left + tagRect.width / 2
            strip = {
              dock,
              index: Number(tagEl.dataset.tabIndex) + (before ? 0 : 1),
              caretX: (before ? tagRect.left : tagRect.right) - stripRect.left,
            }
          } else {
            // Empty header area / after the last tag: append.
            strip = { dock, index: Number.MAX_SAFE_INTEGER, caretX: stripRect.width - 2 }
          }
        }
      } else if (activityEl) {
        activityId = activityEl.dataset.pluginId ?? null
      } else {
        const root = rootRef.current
        if (root) {
          const rect = root.getBoundingClientRect()
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            target = resolveDropTarget(x, y, rect)
          }
        }
      }
      return { target, strip, activityId }
    }

    const flush = () => {
      raf = 0
      resolved = compute(latest.x, latest.y)
      setDrag((d) => (d ? { ...d, x: latest.x, y: latest.y, ...resolved } : d))
    }
    const onMove = (e: PointerEvent) => {
      latest.x = e.clientX
      latest.y = e.clientY
      if (!raf) {
        raf = requestAnimationFrame(flush)
      }
    }
    const onUp = () => {
      if (resolved.strip) {
        handleDrop(dragPanelId, resolved.strip.dock, resolved.strip.index)
      } else if (resolved.target) {
        handleDrop(dragPanelId, resolved.target.slot)
      } else if (resolved.activityId && resolved.activityId !== dragPanelId) {
        handleToggle(dragPanelId)
      }
      setDrag(null)
    }
    const cancel = () => setDrag(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrag(null)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', cancel)
    return () => {
      if (raf) {
        cancelAnimationFrame(raf)
      }
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', cancel)
    }
  }, [dragPanelId, handleDrop, handleToggle])

  const bindResize = useCallback(
    (axis: 'v' | 'h', dock: DockId) => {
      return {
        onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
          e.preventDefault()
          const el = e.currentTarget
          el.setPointerCapture(e.pointerId)
          const start = axis === 'v' ? e.clientX : e.clientY
          const size = axis === 'v' ? containerSize.current.w : containerSize.current.colH
          const key = dock === 'left' ? 'leftPct' : dock === 'right' ? 'rightPct' : 'bottomPct'
          const startPct = layout.sizes[key]
          const onMove = (ev: PointerEvent) => {
            // The right dock's handle sits on its left edge: dragging LEFT must
            // widen it (left and bottom already use the intuitive direction).
            const delta = axis === 'v' ? (dock === 'right' ? start - ev.clientX : ev.clientX - start) : -(ev.clientY - start)
            const pct = startPct + (delta / Math.max(1, size)) * 100
            setLayout((prev) => {
              const next = copyLayout(prev)
              setDockSize(next.sizes, dock, pct)
              return next
            })
          }
          const onUp = () => {
            el.removeEventListener('pointermove', onMove)
            el.removeEventListener('pointerup', onUp)
            el.removeEventListener('pointercancel', onUp)
          }
          el.addEventListener('pointermove', onMove)
          el.addEventListener('pointerup', onUp)
          el.addEventListener('pointercancel', onUp)
        },
      }
    },
    [layout.sizes],
  )

  // Whether a plugin is currently visible anywhere.
  const visible = useMemo(() => {
    const out: Record<string, boolean> = {}
    for (const p of descriptors) {
      out[p.id] = isMobile ? mobileTabs.includes(p.id) : findPanelDock(layout, p.id) !== null
    }
    return out
  }, [layout, descriptors, isMobile, mobileTabs])

  // --- Portals: mount every plugin exactly once, into its stable host node. ---
  const panelPortal = useMemo(
    () => descriptors.map((p) => createPortal(p.node, hostFor(p.id), p.id)),
    [descriptors, hostFor],
  )

  const notHosted = useMemo(() => {
    const activeDocks = new Set<string>()
    if (isMobile) {
      // Only the active mobile tab's host is rendered by the synthetic center
      // dock; the rest stay mounted (hidden) in the vault.
      if (mobileActive) {
        activeDocks.add(mobileActive)
      }
    } else {
      for (const dock of DOCK_ORDER) {
        const st = layout.docks[dock]
        if (st.active) {
          activeDocks.add(st.active)
        }
      }
    }
    return descriptors.filter((p) => !activeDocks.has(p.id))
  }, [descriptors, layout, isMobile, mobileActive])

  const leftTabs = layout.docks.left.tabs.length
  const rightTabs = layout.docks.right.tabs.length
  const bottomTabs = layout.docks.bottom.tabs.length
  const leftVisible = leftTabs > 0 && !layout.hiddenSlots.left
  const rightVisible = rightTabs > 0 && !layout.hiddenSlots.right
  const bottomVisible = bottomTabs > 0 && !layout.hiddenSlots.bottom

  const renderDock = (dock: DockId, className?: string, onHideDock?: () => void, hideHeader?: boolean) => (
    <Dock
      dock={dock}
      state={layout.docks[dock]}
      plugins={descriptors}
      className={className}
      hideHeader={hideHeader}
      draggable={!isMobile}
      onActivate={handleActivate}
      onGripPointerDown={beginPanelDrag}
      caretX={drag?.strip?.dock === dock ? drag.strip.caretX : null}
      onHideDock={onHideDock}
      hostFor={hostFor}
      emptyState={<DropHint />}
    />
  )

  const dockHidden = {
    left: Boolean(layout.hiddenSlots.left),
    right: Boolean(layout.hiddenSlots.right),
    bottom: Boolean(layout.hiddenSlots.bottom),
  }
  const dockEmpty = { left: leftTabs === 0, right: rightTabs === 0, bottom: bottomTabs === 0 }

  const desktopLayout = (
    <div ref={rootRef} className={cn('relative flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div ref={rowRef} className="flex min-h-0 min-w-0 flex-1">
        <ActivityBar
          plugins={descriptors}
          visible={visible}
          onToggle={handleToggle}
          dockHidden={dockHidden}
          dockEmpty={dockEmpty}
          onToggleDock={toggleDock}
        />
        {drag?.target ? (
          <DockOverlay
            target={drag.target}
            labelLeft={t('workbench.dock.left')}
            labelRight={t('workbench.dock.right')}
            labelBottom={t('workbench.dock.bottom')}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1">
          {leftVisible ? (
            <>
              <div className="shrink-0" style={{ width: `${layout.sizes.leftPct}%` }}>
                {renderDock('left', 'h-full min-h-0', () => toggleDock('left'))}
              </div>
              <div
                {...bindResize('v', 'left')}
                className="shrink-0 cursor-col-resize touch-none border-l border-r bg-transparent hover:bg-primary/20"
                style={{ width: 4 }}
                title={DOCK_TOOLTIP.left}
              />
            </>
          ) : null}
          <div ref={centerColRef} className="flex min-w-0 flex-1 flex-col">
            {renderDock('center', 'min-h-0 flex-1')}
            {bottomVisible ? (
              <>
                <div
                  {...bindResize('h', 'bottom')}
                  className="h-1 w-full shrink-0 cursor-row-resize touch-none border-t hover:bg-primary/20"
                  title={DOCK_TOOLTIP.bottom}
                />
                <div className="flex w-full shrink-0 flex-col" style={{ height: `${layout.sizes.bottomPct}%` }}>
                  {renderDock('bottom', 'min-h-0 flex-1', () => toggleDock('bottom'))}
                </div>
              </>
            ) : null}
          </div>
          {rightVisible ? (
            <>
              <div
                {...bindResize('v', 'right')}
                className="shrink-0 cursor-col-resize touch-none border-l border-r bg-transparent hover:bg-primary/20"
                style={{ width: 4 }}
                title={DOCK_TOOLTIP.right}
              />
              <div className="shrink-0 border-r" style={{ width: `${layout.sizes.rightPct}%` }}>
                {renderDock('right', 'h-full min-h-0', () => toggleDock('right'))}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <StatusBar layout={layout} descriptors={descriptors} />
    </div>
  )

  const mobileLayout = (
    <div className={cn('relative flex h-full min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1">
        <Dock
          dock="center"
          state={{ tabs: mobileTabs, active: mobileActive }}
          plugins={descriptors}
          className="h-full"
          draggable={false}
          onActivate={handleActivate}
          onGripPointerDown={beginPanelDrag}
          caretX={null}
          hostFor={hostFor}
          emptyState={<DropHint />}
        />
      </div>
      <ActivityBar
        plugins={descriptors}
        visible={visible}
        onToggle={handleToggle}
        dockHidden={dockHidden}
        dockEmpty={dockEmpty}
        onToggleDock={toggleDock}
        vertical={false}
      />
    </div>
  )

  // Vault keeps every non-visible plugin mounted (hidden) so chat WS, editor
  // buffers and terminal state survive tag switches and drags.
  const vault = (
    <div className="hidden" aria-hidden>
      {notHosted.map((p) => (
        <HostBox key={p.id} host={hostFor(p.id)} />
      ))}
    </div>
  )

  return (
    <>
      {isMobile ? mobileLayout : desktopLayout}
      {vault}
      {panelPortal}
      {drag ? createPortal(
        <div
          style={{ left: drag.x + 12, top: drag.y + 12 }}
          className="pointer-events-none fixed z-[100] flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1 text-xs font-medium shadow-lg"
        >
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="max-w-40 truncate">{descriptors.find((p) => p.id === drag.panelId)?.title}</span>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

export type { PluginDescriptor, WorkbenchPlugin, DockId }