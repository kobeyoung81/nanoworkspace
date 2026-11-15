// Rebuilding the chat transcript from a session's persisted provider messages.
//
// The stored blob is the provider message array: user and assistant content,
// role:"thought" rows, assistant messages carrying tool_calls, and the tool rows
// that answer them. This module owns the mapping from that array to what the
// chat renders. It lives outside AgentPage so the mapping can be reasoned about
// (and tested) without a socket, which is also what keeps the restored transcript
// and the streamed one (hooks/liveMessages) agreeing on the same shapes.
import type { AgentMessage } from '../hooks/useAgent'
import { matchesPendingQuestion, questionPairs, type QuestionLike } from './questionRecord'

// History message ids are derived from the segment, the page's absolute start
// index and the position inside the page. They therefore stay identical when the
// same page is loaded again, which is what lets the virtualised transcript keep
// its measured row heights (a Date.now()-based id would throw them away on every
// reload and make the scrollbar jump).
function historyMessageId(prefix: string, index: number): string {
  return `${prefix}-${index}`
}

type ProviderMessage = {
  role: string
  content?: unknown
  tool_calls?: { id: string; name: string; arguments: string }[]
  tool_call_id?: string
  timestamp?: string
  thought_elapsed_ms?: number
  detail?: string
}

function strContent(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// parseProviderMessages decodes a session's persisted message blob into the
// provider message array. Malformed/absent data yields an empty array.
export function parseProviderMessages(raw: string): ProviderMessage[] {
  try {
    const parsed = JSON.parse(raw) as ProviderMessage[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// messagesFromProvider reconstructs the chat view from the persisted provider
// message array: user/assistant content, role:"thought" rows become folded
// thought blocks, and consecutive assistant(tool_calls)+tool(result) rows are
// batched into one "N tools used" group (inline with the live grouping). A
// `question` call is pulled out of that batching — see the loop below.
//
// `pendingQuestion` is the session's pending-question metadata, passed in so an
// unanswered question call can be told apart from one the user never answered:
// both carry the same tool call, only the pending metadata says which is which.
export function messagesFromProvider(
  parsed: ProviderMessage[],
  idPrefix: string,
  pendingQuestion?: QuestionLike | null,
): AgentMessage[] {
  const out: AgentMessage[] = []
  let toolGroup: { id: string; name: string; args: string; result: string }[] | null = null

  const toolResults = new Map<string, string>()
  for (const m of parsed) {
    if (m.role === 'tool' && m.tool_call_id) {
      toolResults.set(m.tool_call_id, strContent(m.content))
    }
  }

  const flushTools = () => {
    if (toolGroup) {
      out.push({
        id: historyMessageId(idPrefix, out.length),
        role: 'assistant',
        kind: 'tool_group',
        tools: toolGroup,
        streaming: false,
        folded: true,
      })
      toolGroup = null
    }
  }

  for (let i = 0; i < parsed.length; i++) {
    const m = parsed[i]
    if (m.role === 'user') {
      flushTools()
      out.push({ id: historyMessageId(idPrefix, out.length), role: 'user', content: strContent(m.content), streaming: false })
    } else if (m.role === 'error') {
      flushTools()
      out.push({
        id: historyMessageId(idPrefix, out.length),
        role: 'assistant',
        kind: 'error',
        category: strContent(m.content),
        detail: m.detail ?? '',
        streaming: false,
      })
    } else if (m.role === 'thought') {
      flushTools()
      const next = parsed[i + 1]
      let elapsedMs: number | undefined
      if (typeof m.thought_elapsed_ms === 'number' && m.thought_elapsed_ms > 0) {
        elapsedMs = m.thought_elapsed_ms
      } else if (m.timestamp && next?.timestamp) {
        const end = Date.parse(next.timestamp)
        const start = Date.parse(m.timestamp)
        if (Number.isFinite(end) && Number.isFinite(start) && end >= start) {
          elapsedMs = end - start
        }
      }
      out.push({
        id: historyMessageId(idPrefix, out.length),
        role: 'assistant',
        kind: 'thought',
        content: strContent(m.content),
        streaming: false,
        startedAt: 0,
        elapsedMs,
      })
    } else if (m.role === 'compaction') {
      flushTools()
      out.push({
        id: historyMessageId(idPrefix, out.length),
        role: 'assistant',
        kind: 'compaction',
        summary: strContent(m.content),
        streaming: false,
      })
    } else if (m.role === 'assistant') {
      const narration = strContent(m.content)
      if (m.tool_calls && m.tool_calls.length > 0) {
        // A narration emitted before the tool calls renders as its own
        // content bubble (closing any open tool group), matching the live
        // streaming view. Only then do we open/continue the tool group.
        if (narration) {
          flushTools()
          out.push({
            id: historyMessageId(idPrefix, out.length),
            role: 'assistant',
            kind: 'content',
            content: narration,
            streaming: false,
          })
        }
        for (const tc of m.tool_calls) {
          const result = toolResults.get(tc.id) ?? ''
          const pairs = questionPairs(tc.arguments, result)
          if (pairs) {
            // A question is a record of its own, not a step of the tool chain:
            // the answer is the only copy of what the user decided, and it is
            // what somebody scrolling back is looking for. It closes the open
            // group, so the chain above and below it stays readable.
            flushTools()
            out.push({
              id: historyMessageId(idPrefix, out.length),
              role: 'assistant',
              kind: 'question',
              args: tc.arguments,
              result,
              // In a question record `streaming` means "still waiting for an
              // answer" — the same meaning the live path gives it.
              streaming: pairs.every((pair) => pair.answer === null) && matchesPendingQuestion(pairs, pendingQuestion),
            })
            continue
          }
          if (!toolGroup) {
            toolGroup = []
          }
          toolGroup.push({ id: tc.id, name: tc.name, args: tc.arguments, result })
        }
      } else {
        flushTools()
        // Skip empty assistant rows (aborted/empty completions persisted by
        // older code) so restored history shows no blank bubbles.
        if (narration.trim() !== '') {
          out.push({
            id: historyMessageId(idPrefix, out.length),
            role: 'assistant',
            kind: 'content',
            content: narration,
            streaming: false,
          })
        }
      }
    }
    // tool rows are folded into the open tool group via toolResults
  }
  flushTools()
  return out
}
