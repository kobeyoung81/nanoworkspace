// Reading goal rounds out of the transcript.
//
// Two facts about the goal loop live in the conversation rather than in the goal
// document: the round's brief, which the scheduler posts as an inbound message
// and which therefore lands as an ordinary user message, and the report's answer,
// which is JSON in a `goal_report` tool result. Both are parsed here, as pure
// functions, so the render code never guesses and the rules are testable without
// a browser.

/** A round's brief, recognised by the heading the scheduler writes. */
export type GoalPrompt = {
  /** A work round or the re-check that follows a "met". */
  kind: 'work' | 'verify'
  /** The number the reader sees. 0 for a verification round (it keeps the
   *  number of the round it re-proves, which the heading does not carry). */
  round: number
  /** The goal's first line, for the folded summary. '' when it cannot be read. */
  goal: string
}

/** What the judge answered, as the tool returned it. */
export type GoalJudgeResult = {
  delivered: boolean
  /** met | not_yet | impossible */
  verdict: string
  reason: string
  /** The round the verdict belongs to, one-based. */
  round: number
  verify: boolean
}

const WORK_HEAD = /^【长程目标 · 第\s*(\d+)\s*轮】/
const VERIFY_HEAD = /^【长程目标 · 复验轮】/

const VERDICTS = new Set(['met', 'not_yet', 'impossible'])

/**
 * parseGoalPrompt recognises a round's brief.
 *
 * The heading is written by the scheduler's own template, so it is a stable
 * marker — and a user message that merely quotes those characters does not start
 * with them.
 */
export function parseGoalPrompt(content: string): GoalPrompt | null {
  const text = content.trimStart()
  if (VERIFY_HEAD.test(text)) {
    return { kind: 'verify', round: 0, goal: goalLine(text) }
  }
  const work = WORK_HEAD.exec(text)
  if (!work) {
    return null
  }
  const round = Number(work[1])
  if (!Number.isFinite(round) || round < 1) {
    return null
  }
  return { kind: 'work', round, goal: goalLine(text) }
}

/**
 * goalLine is the first non-empty line after the brief's 目标 heading. It is what
 * the folded block shows, so it has to be the goal itself rather than the
 * heading's neighbours.
 */
function goalLine(text: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.trim() === '目标')
  if (at < 0) {
    return ''
  }
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line) {
      return line
    }
    // A blank goal is possible (a condition that is only whitespace); look no
    // further than the next section heading.
    if (i > at + 2) {
      break
    }
  }
  return ''
}

/**
 * parseJudgeResult reads the judge's answer out of a goal_report result.
 *
 * It returns null for anything that is not the structured shape, which is how an
 * older transcript — a Chinese sentence — degrades to "no judge card" instead of
 * a card full of nothing.
 */
export function parseJudgeResult(result: string): GoalJudgeResult | null {
  const text = result?.trim() ?? ''
  if (!text.startsWith('{')) {
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  const verdict = typeof record.verdict === 'string' ? record.verdict : ''
  if (!VERDICTS.has(verdict)) {
    return null
  }
  const round = typeof record.round === 'number' && Number.isFinite(record.round) ? record.round : 0
  return {
    delivered: record.delivered === true,
    verdict,
    reason: typeof record.reason === 'string' ? record.reason : '',
    round,
    verify: record.verify === true,
  }
}
