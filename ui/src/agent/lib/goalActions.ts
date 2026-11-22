// Which row actions a goal's state offers in the tasks panel.
//
// The buttons are always visible — a row used to hide every action until the
// pointer was over it, which is why a queued goal looked like it had none. The
// matrix is the user's (2026-11-21): queued and stopped goals can be cancelled,
// paused goals can be resumed, a goal that is already stopping offers nothing
// but delete, and delete is available in every state.

export type TaskAction = 'pause' | 'resume' | 'cancel' | 'delete' | 'open'

/** taskActions returns the buttons a row shows, in render order. */
export function taskActions(status: string): TaskAction[] {
  const running = status === 'running' || status === 'verifying'
  const paused = status === 'paused'
  // A draft is not running, so stopping it is refused by the lifecycle table
  // (Draft → Cancelling is not an edge); deleting it is what removes it.
  const cancellable = running || paused || status === 'ready'
  const out: TaskAction[] = []
  if (running) out.push('pause')
  if (paused) out.push('resume')
  if (cancellable) out.push('cancel')
  out.push('delete', 'open')
  return out
}
