// Live-stream assembly for one turn.
//
// The agent streams a turn as interleaved frames: reasoning ("thought"), answer
// ("content"), tool calls and the compaction summary. Every frame carries the
// message_id of the LLM iteration it belongs to, and one iteration's thought and
// answer share it.
//
// The client used to append to whatever happened to be the last element, which
// broke the moment a frame arrived out of phase: a reasoning tail landing after
// the answer opened a *second* thought block (the "0.1s" stub) and left the
// answer bubble orphaned, so the end-of-turn patch only ever filled the last one
// and the orphan kept its first characters. Blocks are therefore keyed by
// (message_id, kind): a thought always lands in its own iteration's block, which
// stays above that iteration's answer.

import type { AgentMessage } from './useAgent'
import { parseQuestions } from '../lib/questionRecord'

/** One streamed frame, normalised by the caller. */
export type LiveChunk = {
  /** content | thought | tool_use | tool_result | summary */
  kind: string
  content: string
  /** LLM iteration the frame belongs to; absent on older agents. */
  messageId?: string
}

export type IdFactory = () => string

function blockKind(kind: string): string {
  if (kind === 'tool_use' || kind === 'tool_result') {
    return 'tool_group'
  }
  return kind || 'content'
}

/** The question record still waiting for an answer, or -1.
 *
 * A question blocks its turn, so at most one record can be open: the answer
 * frame that follows belongs to it rather than to the tool list. */
function awaitingQuestionIndex(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'assistant' && message.kind === 'question' && message.streaming) {
      return i
    }
  }
  return -1
}

function blockId(messageId: string, kind: string): string {
  return `live-${messageId}-${blockKind(kind)}`
}

/**
 * Where a frame belongs: the index of its block, or -1 when the block has to be
 * created. Frames without an iteration id keep the positional rule the client
 * used before (append to the last element when it is the same streaming block).
 */
function targetIndex(copy: AgentMessage[], chunk: LiveChunk, nextId: IdFactory): { index: number; id: string } {
  if (chunk.messageId) {
    const id = blockId(chunk.messageId, chunk.kind)
    return { index: copy.findIndex((message) => message.id === id), id }
  }
  const last = copy.length - 1
  const previous = copy[last]
  if (
    previous &&
    previous.role === 'assistant' &&
    previous.streaming &&
    previous.kind === blockKind(chunk.kind)
  ) {
    return { index: last, id: previous.id }
  }
  return { index: -1, id: nextId() }
}

/**
 * Closes every streaming thought/tool block: only the newest block may flash,
 * and an earlier one left open would keep its indicator running under a newer
 * response.
 */
export function finalizeBlocks(messages: AgentMessage[], at: number): AgentMessage[] {
  return messages
    .map((message) => {
      if (message.role !== 'assistant' || !message.streaming) {
        return message
      }
      if (message.kind === 'thought') {
        return { ...message, streaming: false, elapsedMs: Math.max(0, at - message.startedAt) }
      }
      return { ...message, streaming: false }
    })
    .filter((message) => !(message.role === 'assistant' && message.kind === 'content' && message.content.trim() === ''))
}

/**
 * The end-of-turn patch: the completion carries the authoritative answer, so the
 * last answer block is replaced by it (or one is added when nothing streamed).
 * Now that every iteration has exactly one answer block, "the last one" is the
 * answer of the iteration that just finished.
 */
export function patchFinalAnswer(messages: AgentMessage[], finalContent: string, nextId: IdFactory): AgentMessage[] {
  const copy = [...messages]
  for (let i = copy.length - 1; i >= 0; i--) {
    const message = copy[i]
    if (message.role === 'assistant' && message.kind === 'content') {
      copy[i] = { ...message, content: finalContent, streaming: false }
      return copy
    }
  }
  copy.push({ id: nextId(), role: 'assistant', kind: 'content', content: finalContent, streaming: false })
  return copy
}

/** Applies one streamed frame to the transcript. */
export function appendLiveChunk(
  messages: AgentMessage[],
  chunk: LiveChunk,
  nextId: IdFactory,
  at: number,
): AgentMessage[] {
  const copy = [...messages]
  const kind = blockKind(chunk.kind)

  if (kind === 'content') {
    const finalized = finalizeBlocks(copy, at)
    const { index, id } = targetIndex(finalized, chunk, nextId)
    if (index >= 0) {
      const message = finalized[index]
      if (message.role === 'assistant' && message.kind === 'content') {
        // Whitespace is appended verbatim so in-progress spacing is preserved.
        finalized[index] = { ...message, content: message.content + chunk.content, streaming: true }
        return finalized
      }
    }
    if (chunk.content.trim() === '') {
      // An empty delta must not open a bubble that lingers until end-of-turn.
      return finalized
    }
    // A new iteration's answer goes after everything this turn produced so far.
    finalized.push({ id, role: 'assistant', kind: 'content', content: chunk.content, streaming: true })
    return finalized
  }

  if (kind === 'thought') {
    const { index, id } = targetIndex(copy, chunk, nextId)
    if (index >= 0) {
      const message = copy[index]
      if (message.role === 'assistant' && message.kind === 'thought') {
        copy[index] = { ...message, content: message.content + chunk.content, streaming: true }
        return copy
      }
    }
    finalizeBlocksInPlace(copy, at)
    // A thought that arrives after its iteration's answer is still that
    // iteration's reasoning: keep it above the answer it belongs to.
    insertBefore(copy, chunk.messageId ? blockId(chunk.messageId, 'content') : '', {
      id,
      role: 'assistant',
      kind: 'thought',
      content: chunk.content,
      streaming: true,
      startedAt: at,
    })
    return copy
  }

  if (kind === 'tool_group') {
    if (chunk.kind === 'tool_result') {
      // A question's result *is* the user's answer, and it belongs to the
      // question record opened when the call streamed in — not to the tool list.
      const awaiting = awaitingQuestionIndex(copy)
      if (awaiting >= 0) {
        const message = copy[awaiting]
        if (message.role === 'assistant' && message.kind === 'question') {
          copy[awaiting] = { ...message, result: chunk.content, streaming: false }
        }
        return copy
      }
    }
    const { index, id } = targetIndex(copy, chunk, nextId)
    if (chunk.kind === 'tool_result') {
      const message = index >= 0 ? copy[index] : null
      if (message && message.role === 'assistant' && message.kind === 'tool_group' && message.tools.length > 0) {
        const tools = message.tools.map((tool, i) =>
          i === message.tools.length - 1 ? { ...tool, result: chunk.content } : tool,
        )
        copy[index] = { ...message, tools }
      }
      return copy
    }
    // tool_use
    let name = chunk.content
    let args = ''
    try {
      const parsed = JSON.parse(chunk.content) as { name?: string; arguments?: string }
      name = parsed.name ?? chunk.content
      args = parsed.arguments ?? ''
    } catch {
      // not JSON — render the raw content as the tool name
    }
    if (name === 'question' && parseQuestions(args)) {
      // The question is its own record rather than a step of the tool chain:
      // the answer it will carry is the part of the exchange worth reading back.
      let questionId = chunk.messageId ? blockId(chunk.messageId, 'question') : nextId()
      if (copy.some((message) => message.id === questionId)) {
        // A second question in the same iteration keeps its own record.
        questionId = nextId()
      }
      finalizeBlocksInPlace(copy, at)
      copy.push({
        id: questionId,
        role: 'assistant',
        kind: 'question',
        args,
        result: '',
        streaming: true,
      })
      return copy
    }
    if (index >= 0) {
      const message = copy[index]
      if (message.role === 'assistant' && message.kind === 'tool_group') {
        copy[index] = { ...message, tools: [...message.tools, { name, args, result: '' }], streaming: true }
        return copy
      }
    }
    finalizeBlocksInPlace(copy, at)
    // Appended, not inserted: a tool call follows the narration of its own
    // iteration, which is also the order the persisted transcript replays.
    copy.push({
      id,
      role: 'assistant',
      kind: 'tool_group',
      tools: [{ name, args, result: '' }],
      streaming: true,
      folded: true,
    })
    return copy
  }

  if (kind === 'summary') {
    finalizeBlocksInPlace(copy, at)
    const last = copy[copy.length - 1]
    if (last && last.role === 'assistant' && last.kind === 'compaction' && last.streaming) {
      copy[copy.length - 1] = { ...last, summary: last.summary + chunk.content }
    } else {
      copy.push({ id: nextId(), role: 'assistant', kind: 'compaction', summary: chunk.content, streaming: true })
    }
    return copy
  }

  return copy
}

/**
 * Ensures the transcript carries a streaming compaction divider while the server
 * reports a compaction in flight. The divider that ships with the row is written
 * only once the summary is in, so a pane that reads (or re-reads) the segment
 * mid-compaction would otherwise show nothing at all until the next summary chunk
 * arrives — which is exactly the "Compacting…" line that vanished on reload.
 */
export function ensureCompactionDivider(
  messages: AgentMessage[],
  compacting: boolean,
  nextId: IdFactory,
): AgentMessage[] {
  if (!compacting) {
    return messages
  }
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant' && last.kind === 'compaction' && last.streaming) {
    return messages
  }
  return [...messages, { id: nextId(), role: 'assistant', kind: 'compaction', summary: '', streaming: true }]
}

/**
 * Fills a compaction divider from the summary the completion carries.
 *
 * The streamed summary chunks are the normal source, but they are not a
 * guaranteed one: the provider may send no deltas at all, a `/compact` with
 * nothing new to summarize streams nothing, and a dropped socket loses what it
 * missed. The completion is the authoritative copy, so a divider that never got
 * its text still shows the result — without a page reload.
 *
 * Replaces the last compaction block's summary (and stops it flashing); appends
 * a divider when the transcript has none, so a completion that reports a
 * compaction can never be silent.
 */
export function patchCompactionSummary(
  messages: AgentMessage[],
  summary: string,
  nextId: IdFactory,
): AgentMessage[] {
  if (summary === '') {
    return messages
  }
  const copy = [...messages]
  for (let i = copy.length - 1; i >= 0; i--) {
    const message = copy[i]
    if (message.role === 'assistant' && message.kind === 'compaction') {
      copy[i] = { ...message, summary, streaming: false }
      return copy
    }
  }
  copy.push({ id: nextId(), role: 'assistant', kind: 'compaction', summary, streaming: false })
  return copy
}

function finalizeBlocksInPlace(copy: AgentMessage[], at: number): void {
  for (let i = 0; i < copy.length; i++) {
    const message = copy[i]
    if (message.role !== 'assistant' || !message.streaming) {
      continue
    }
    if (message.kind === 'thought') {
      copy[i] = { ...message, streaming: false, elapsedMs: Math.max(0, at - message.startedAt) }
    } else if (message.kind === 'tool_group') {
      // A question record is deliberately left open here: a late frame of the
      // same iteration must not close it, or the answer that is still on its way
      // would have nowhere to land. The turn's end closes it (finalizeBlocks).
      copy[i] = { ...message, streaming: false }
    }
  }
}

function insertBefore(copy: AgentMessage[], id: string, message: AgentMessage): void {
  const index = id ? copy.findIndex((item) => item.id === id) : -1
  if (index < 0) {
    copy.push(message)
    return
  }
  copy.splice(index, 0, message)
}
