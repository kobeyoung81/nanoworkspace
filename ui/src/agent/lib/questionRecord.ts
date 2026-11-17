/**
 * The exchange a `question` tool call leaves behind: what the agent asked and
 * what the user chose.
 *
 * The answer never comes back as a user message. The agent consumes the reply
 * that carries `metadata.question_id` (nanosec `internal/agent/agent.go`,
 * "route an answer to a waiting question") and the only copy of the user's
 * choice is the tool's return value — a JSON array with one string per question
 * (`nanosec/internal/tool/question.go`). Rebuilding the pair from the call and
 * its result is what lets the transcript show the answer as a record of its own
 * instead of burying the most important line of the exchange in a tool blob.
 */

/** The parts of a pending question this module needs (see `PendingQuestion`). */
export type QuestionLike = { questions: { question: string }[] }

/** One asked question and the answer it got, or null when nobody answered. */
export type QuestionPair = { question: string; header?: string; answer: string | null }

/**
 * The questions in a tool call's arguments, or null when this is not a
 * `question` call at all (the caller then renders an ordinary tool card).
 */
export function parseQuestions(args: string): { question: string; header?: string }[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return null
  }
  const raw = (parsed as { questions?: unknown } | null)?.questions
  if (!Array.isArray(raw)) {
    return null
  }
  const questions: { question: string; header?: string }[] = []
  for (const item of raw) {
    const question = typeof (item as { question?: unknown })?.question === 'string' ? (item as { question: string }).question.trim() : ''
    if (question === '') {
      continue
    }
    const header = typeof (item as { header?: unknown })?.header === 'string' ? (item as { header: string }).header.trim() : ''
    questions.push(header === '' ? { question } : { question, header })
  }
  return questions.length > 0 ? questions : null
}

/**
 * The answers in a tool result, aligned positionally with the questions (the
 * agent answers one string per question). Anything that is not a JSON string
 * array — an empty result while the turn waits, or an error text — leaves every
 * slot null, which the transcript renders as "no answer".
 */
export function parseAnswers(result: string, count: number): (string | null)[] {
  const answers: (string | null)[] = Array.from({ length: count }, () => null)
  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch {
    return answers
  }
  if (!Array.isArray(parsed)) {
    return answers
  }
  parsed.forEach((value, index) => {
    if (index < count && typeof value === 'string') {
      answers[index] = value
    }
  })
  return answers
}

/** The asked/answered pairs of a `question` call, or null when it is not one. */
export function questionPairs(args: string, result: string): QuestionPair[] | null {
  const questions = parseQuestions(args)
  if (!questions) {
    return null
  }
  const answers = parseAnswers(result, questions.length)
  return questions.map((question, index) => ({ ...question, answer: answers[index] ?? null }))
}

/**
 * Whether a question in the transcript is the one the session is waiting on.
 *
 * The tool call carries no question id — nanosec mints that separately
 * (`internal/agent/loop.go`, the `question` branch of the tool hook) and only
 * the pending-question metadata has it — so the match is on the questions
 * themselves. That is enough to tell "nobody has answered yet" from "nobody
 * ever answered" without trusting an unanswered call on its own.
 */
export function matchesPendingQuestion(pairs: QuestionPair[], pending: QuestionLike | null | undefined): boolean {
  const asked = pending?.questions
  if (!asked || asked.length !== pairs.length || pairs.length === 0) {
    return false
  }
  return pairs.every((pair, index) => pair.question.trim() === (asked[index]?.question ?? '').trim())
}
