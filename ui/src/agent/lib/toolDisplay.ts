/**
 * How a tool call's arguments are shown in the transcript.
 *
 * The arguments are a JSON string on a single line, and a real one can be long
 * enough to be unreadable as one wrapped blob. Pretty-printing only what is JSON
 * keeps the call scannable while staying honest about anything else (a tool whose
 * arguments are not JSON is shown exactly as the model sent it).
 */
export function formatToolArgs(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return raw
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 2)
    }
  } catch {
    // Not JSON: show the text as it is.
  }
  return raw
}
