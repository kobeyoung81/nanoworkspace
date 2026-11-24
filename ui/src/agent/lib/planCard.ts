// Reading a plan for the card that offers to turn it into a goal (product §5.3).
//
// The card shows a title, the step count and the first three steps; the full
// text is read only when the reader expands it. The rules match the workspace's
// ParsePlan (internal/goal/plan.go) so the card and the pre-filled condition
// cannot disagree about what a plan says.

export type PlanCard = {
  title: string
  steps: string[]
}

const HEADING = /^#{1,6}\s*(.+?)\s*$/
const STEP = /^\s*(?:[-*+]|\d+[.)、．])\s*(.*\S)\s*$/

/** The section headings a plan uses for its steps. */
const STEP_SECTIONS = new Set(['步骤', 'steps', '怎么走'])

/** parsePlanCard reads what the card shows: the H1 title and the step list. */
export function parsePlanCard(markdown: string): PlanCard {
  const lines = (markdown ?? '').split('\n')
  let title = ''
  const steps: string[] = []
  let section = ''
  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (heading) {
      const name = heading[1].trim()
      if (title === '') title = name
      section = name.toLowerCase()
      continue
    }
    if (!STEP_SECTIONS.has(section)) continue
    const step = STEP.exec(line)
    if (step) steps.push(step[1].trim())
  }
  return { title: title || '', steps }
}

/** planPathOfResult reads the path a plan_write call answered with.
 *
 * The tool result is "Plan written to <path> (<n> bytes). …"; this mirrors the
 * agent's own PlanPathFromResult so the card can be attached to the message that
 * wrote it, not to whatever happens to be last.
 */
export function planPathOfResult(result: string | undefined): string {
  const marker = 'Plan written to '
  const at = (result ?? '').indexOf(marker)
  if (at < 0) return ''
  const rest = (result ?? '').slice(at + marker.length)
  const stop = rest.indexOf(' (')
  return (stop >= 0 ? rest.slice(0, stop) : rest).trim()
}
