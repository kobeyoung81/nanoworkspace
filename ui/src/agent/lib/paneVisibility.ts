// How a conversation pane hides itself.
//
// Every open conversation keeps its socket and its transcript mounted, so a tab
// switch must not rebuild anything: the panes share one geometry and only their
// visibility changes. `display:none` is deliberately not used — it removes the
// layout box, and the virtualised transcript measures itself (a box-less list
// reports zero heights and has to be unmounted, which is what made a switch
// paint an empty pane for a frame before the list came back).
//
// `visibility: hidden` keeps the box: the list stays mounted, measured and
// scrolled where the reader left it, and showing it again is a style change.

/** The geometry every pane uses, visible or not. */
const PANE_LAYER_BASE = 'absolute inset-0 flex min-h-0 flex-col'

/** What a pane that is not on screen adds. */
const PANE_LAYER_HIDDEN = 'invisible pointer-events-none'

export function paneLayerClass(active: boolean): string {
  return active ? PANE_LAYER_BASE : `${PANE_LAYER_BASE} ${PANE_LAYER_HIDDEN}`
}

/** Panes that are off screen are hidden from assistive technology too. */
export function paneLayerAriaHidden(active: boolean): boolean {
  return !active
}

/**
 * Whether the user is actually looking at this conversation.
 *
 * "Open" is not "looking": every tab keeps its pane mounted, the workbench hides
 * the panels it is not showing behind `display:none`, and a backgrounded browser
 * tab keeps its React tree alive. Unread badges may only clear for the
 * conversation that passes all three checks — otherwise a message that arrives in
 * a background tab is marked read the moment it lands.
 */
export function isReadingConversation(input: {
  /** This conversation's tab is the active one. */
  tabActive: boolean
  /** The chat panel itself is on screen (see useIsLaidOut). */
  panelVisible: boolean
  /** The browser page is visible (not a background tab, not a backgrounded app). */
  documentVisible: boolean
}): boolean {
  return input.tabActive && input.panelVisible && input.documentVisible
}
