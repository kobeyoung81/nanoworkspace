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
