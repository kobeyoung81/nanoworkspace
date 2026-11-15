// The dictation recorder: microphone → 24 kHz PCM16 → voice WebSocket → text.
//
// The socket carries raw PCM frames up and normalized events down, so the only
// browser-side work is capture, framing and folding the events into a
// transcript (the pure halves live in pcm.ts and events.ts).
//
// One session per dictation, and the dictation — not the session — owns the
// lifetime: `start` mints a single-use id and connects, `stop` commits and waits
// for the final transcript, and if the provider session ends first the recorder
// continues on a fresh one (up to MAX_RECONNECTS) rather than dropping what the
// user already said. Every delivery path runs the same finalize, so a lost
// session still gets its transcript and its polish pass.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { downsampleTo, floatToPcm16, levelOf, TARGET_RATE } from './pcm'
import {
  applyVoiceEvent,
  emptyTranscript,
  endsDictation,
  onUpstreamLost,
  polishFallback,
  transcriptText,
  type DictationPhase,
  type VoiceEvent,
  type VoiceTranscript,
} from './events'
import {
  openVoiceSession,
  polishTranscript,
  refineTranscript,
  RefineUnavailable,
  voiceWsUrl,
  type BatchTrigger,
} from './api'
import { wantsBatch, wantsPolish, type VoicePhase } from './stageUi'
import { REFINE_RATE, framesToWav } from './wav'
import { buildCaptureGraph, captureConstraints } from './capture'
import { readMicSettings } from '../lib/micSettings'

// The phase vocabulary lives with the stage rules (stageUi.ts), so the composer
// and the recorder cannot drift apart on what "finalizing" or "refining" means.
export type { VoicePhase }

export type VoiceErrorCode =
  | 'unsupported'
  | 'not_configured'
  | 'mic_denied'
  | 'unavailable'
  | 'failed'
  | 'batch_failed'
  | 'batch_unavailable'

export type VoiceWarning = 'polish_failed' | 'interrupted' | 'empty' | 'batch_failed' | 'batch_unavailable'

export type VoiceResult = {
  /** What belongs in the composer: the polished text when the pass succeeded. */
  text: string
  warning?: VoiceWarning
  /** Free-text detail for the toast: the provider's message or the close code. */
  detail?: string
}

export type VoiceRecorder = {
  phase: VoicePhase
  /** The box's provisional text: the realtime result, then the batch pass's, then
   * the polished one — replaced in place until the underline drops. */
  transcript: string
  elapsedMs: number
  /** 0..1 loudness, read by the meter without re-rendering per frame. */
  levelRef: MutableRefObject<number>
  start: () => void
  stop: () => void
  cancel: () => void
  /** refine re-runs the batch pass on the take that was just recorded. */
  refine: () => void
  /** canRefine is true while that take is still in memory and worth re-running. */
  canRefine: boolean
}

export type UseRealtimeVoiceOptions = {
  /** Longest single dictation, in seconds (from the platform config). */
  maxSeconds: number
  /** Whether the platform has a polish model configured. */
  polishEnabled: boolean
  /** The platform's batch tier: whether it runs, and what the composer offers. */
  batch: { enabled: boolean; trigger: BatchTrigger; skipAfterBatch: boolean }
  /** The realtime tier's capture rate (the local model wants 16 kHz, the OpenAI
   * contract 24 kHz). A session's own answer overrides it. */
  audioRate: number
  onResult: (result: VoiceResult) => void
  onError: (code: VoiceErrorCode, detail?: string) => void
}

/** How long the local take may take to settle before the batch pass carries on. */
const FINALIZE_TIMEOUT_MS = 20000
/** Frame size for the capture tap (~170 ms at 24 kHz, ~256 ms at 16 kHz). */
const FRAME_SAMPLES = 4096

/**
 * keepsAudioForManualRefine reports whether a finished take is worth keeping in
 * memory: only the manual trigger has a caller for it afterwards.
 */
function keepsAudioForManualRefine(batch: UseRealtimeVoiceOptions['batch'], frames: number): boolean {
  return batch.enabled && batch.trigger === 'manual' && frames > 0
}

export function voiceSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions): VoiceRecorder {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [transcript, setTranscript] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [canRefine, setCanRefine] = useState(false)

  const phaseRef = useRef<VoicePhase>('idle')
  const transcriptRef = useRef<VoiceTranscript>(emptyTranscript())
  const levelRef = useRef(0)
  const deliveredRef = useRef(false)
  // One take runs the chain once: several endings can land for the same dictation
  // (the commit's answer, a lost socket, the finalize backstop), and each of them
  // would otherwise start the batch pass all over again.
  const finalizingRef = useRef(false)
  // The capture buffer: the batch pass re-transcribes the whole take, so the
  // frames the socket already carried are kept in memory until the next take
  // starts. A 120 s take at 24 kHz is under 6 MB.
  const framesRef = useRef<Uint8Array<ArrayBuffer>[]>([])
  // abortRef cancels a pass in flight when the user hits ✕.
  const abortRef = useRef<AbortController | null>(null)
  const reconnectsRef = useRef(0)
  const detailRef = useRef('')

  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sinkRef = useRef<GainNode | null>(null)
  const tickRef = useRef<number | null>(null)
  const finalizeTimerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const maxSecondsRef = useRef(options.maxSeconds)
  const rateRef = useRef(options.audioRate || TARGET_RATE)

  // The callbacks below run from socket handlers and timers, so they read the
  // latest options through a ref instead of closing over one render's props.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const setPhaseBoth = useCallback((next: VoicePhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const stopCapture = useCallback(() => {
    const processor = processorRef.current
    if (processor) {
      processor.onaudioprocess = null
      processor.disconnect()
    }
    processorRef.current = null
    sinkRef.current?.disconnect()
    sinkRef.current = null
    const ctx = audioCtxRef.current
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {})
    }
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    levelRef.current = 0
  }, [])

  const closeSocket = useCallback(() => {
    const ws = wsRef.current
    wsRef.current = null
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      // Detach first so the close we are causing does not look like a failure.
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      ws.close()
    }
  }, [])

  const clearFinalizeTimer = useCallback(() => {
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current)
      finalizeTimerRef.current = null
    }
  }, [])

  const teardown = useCallback(() => {
    stopCapture()
    closeSocket()
    clearFinalizeTimer()
  }, [stopCapture, closeSocket, clearFinalizeTimer])

  /** finish hands the result over exactly once and returns to idle. */
  const finish = useCallback(
    (result: VoiceResult) => {
      if (deliveredRef.current) {
        return
      }
      deliveredRef.current = true
      finalizingRef.current = false
      teardown()
      transcriptRef.current = emptyTranscript()
      setTranscript('')
      setElapsedMs(0)
      setPhaseBoth('idle')
      // The take stays in memory while the platform's manual trigger may still
      // want it: that is what the composer's "re-run with the accurate model"
      // button asks for.
      setCanRefine(keepsAudioForManualRefine(optionsRef.current.batch, framesRef.current.length))
      optionsRef.current.onResult(result)
    },
    [setPhaseBoth, teardown],
  )

  const fail = useCallback(
    (code: VoiceErrorCode, detail?: string) => {
      deliveredRef.current = true
      finalizingRef.current = false
      teardown()
      transcriptRef.current = emptyTranscript()
      setTranscript('')
      setElapsedMs(0)
      setPhaseBoth('idle')
      optionsRef.current.onError(code, detail)
    },
    [setPhaseBoth, teardown],
  )

  /** showStageText puts a stage's result on screen as the provisional text. */
  const showStageText = useCallback((text: string) => {
    transcriptRef.current = applyVoiceEvent(emptyTranscript(), { type: 'done', text } satisfies VoiceEvent)
    setTranscript(text)
  }, [])

  /**
   * batchPass re-transcribes the buffered take with the platform's batch model.
   * A failure is returned as a warning rather than thrown: the realtime
   * transcript is still a usable answer, and losing it to a failed second pass
   * would be worse than living with the first one.
   */
  const batchPass = useCallback(async (): Promise<{ text: string; warning?: VoiceWarning; aborted?: boolean }> => {
    if (framesRef.current.length === 0) {
      return { text: '', warning: 'batch_unavailable' }
    }
    // The backstop below exists for the realtime layer's own final transcript;
    // from here the take is in later stages and it must not fire behind them.
    clearFinalizeTimer()
    const controller = new AbortController()
    abortRef.current = controller
    setPhaseBoth('refining')
    try {
      const blob = framesToWav(framesRef.current, rateRef.current, REFINE_RATE)
      const refined = await refineTranscript(blob, 'take.wav', controller.signal)
      const text = (refined.text ?? '').trim()
      if (!text) {
        return { text: '', warning: 'batch_failed' }
      }
      // Show it now: this is the box's new provisional text, and showing it only
      // at the end is what made the stage marker move on its own.
      showStageText(text)
      return { text }
    } catch (err) {
      if (controller.signal.aborted) {
        // The user cancelled: no warning, and the composer keeps what it has.
        return { text: '', aborted: true }
      }
      return { text: '', warning: err instanceof RefineUnavailable ? 'batch_unavailable' : 'batch_failed' }
    } finally {
      abortRef.current = null
    }
  }, [clearFinalizeTimer, setPhaseBoth, showStageText])

  /**
   * deliver lands one text in the composer, through the polish pass when the
   * platform wants it. Every ending — the realtime layer finishing, the batch
   * pass landing, a reconnect giving up — goes through here, which is what makes
   * "the transcript is always polished" true.
   */
  const deliver = useCallback(
    async (text: string, warning: VoiceWarning | undefined, skipPolish: boolean) => {
      if (deliveredRef.current) {
        return
      }
      if (!text) {
        finish({ text: '', warning: warning ?? 'empty', detail: detailRef.current })
        return
      }
      if (skipPolish || !optionsRef.current.polishEnabled || !wantsPolish(text)) {
        finish({ text, warning, detail: detailRef.current })
        return
      }
      clearFinalizeTimer()
      setPhaseBoth('polishing')
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const polished = await polishTranscript(text, controller.signal)
        if (controller.signal.aborted) {
          return
        }
        if (polished.warning) {
          finish({ text, warning: warning ?? 'polish_failed', detail: detailRef.current })
          return
        }
        const rewritten = polishFallback(text, polished.text ?? '')
        // Show the rewrite before the underline drops, so the last stage is
        // visible as a step rather than as the final state appearing at once.
        showStageText(rewritten)
        finish({ text: rewritten, warning, detail: detailRef.current })
      } catch {
        if (controller.signal.aborted) {
          return
        }
        finish({ text, warning: warning ?? 'polish_failed', detail: detailRef.current })
      } finally {
        abortRef.current = null
      }
    },
    [clearFinalizeTimer, finish, setPhaseBoth, showStageText],
  )

  /**
   * finalize is the single delivery path: whatever ended the session, the text
   * we have goes through the batch pass (when the platform asks for it) and then
   * the polish pass, and lands in the composer. Skipping polish on the "it
   * broke" path is what once made a cut-off dictation look like it had no polish
   * step at all.
   */
  const finalize = useCallback(
    async (transcript: string) => {
      if (finalizingRef.current) {
        return
      }
      finalizingRef.current = true
      clearFinalizeTimer()
      const local = transcript.trim()
      const batch = optionsRef.current.batch
      const elapsed = startedAtRef.current ? Date.now() - startedAtRef.current : 0

      let text = local
      let warning: VoiceWarning | undefined
      let batchRan = false
      if (batch.enabled && wantsBatch(batch.trigger, local, elapsed)) {
        const refined = await batchPass()
        if (refined.aborted || deliveredRef.current) {
          return
        }
        if (refined.warning) {
          warning = refined.warning
        } else {
          text = refined.text
          batchRan = true
        }
      }
      await deliver(text, warning, batchRan && batch.skipAfterBatch)
    },
    [batchPass, clearFinalizeTimer, deliver],
  )

  const handleEvent = useCallback(
    (data: unknown) => {
      if (deliveredRef.current) {
        return
      }
      let event: VoiceEvent
      try {
        event = JSON.parse(typeof data === 'string' ? data : String(data)) as VoiceEvent
      } catch {
        return
      }
      switch (event.type) {
        case 'warning':
          detailRef.current = event.message ?? detailRef.current
          return
        case 'error':
          // A provider complaint is not the end of the dictation: the bus hangs
          // up right after, and the close handler decides whether to continue on
          // a new session. Keep the reason for the toast.
          detailRef.current = event.message ?? detailRef.current
          if (phaseRef.current === 'finalizing') {
            void finalize(transcriptText(transcriptRef.current))
          }
          return
        default:
          break
      }
      const dictationPhase: DictationPhase = phaseRef.current === 'finalizing' ? 'finalizing' : 'recording'
      const done = endsDictation(dictationPhase, event)
      const next = applyVoiceEvent(transcriptRef.current, event)
      transcriptRef.current = next
      setTranscript(transcriptText(next))
      if (done) {
        void finalize(transcriptText(next))
      }
    },
    [finalize],
  )


  // attachSocket and reconnect call each other; the ref breaks the cycle without
  // either of them being re-created on every render.
  const reconnectRef = useRef<() => void>(() => {})

  /** attachSocket wires one session's socket; the audio pipeline is shared. */
  const attachSocket = useCallback(
    (sessionId: string) => {
      const ws = new WebSocket(voiceWsUrl(sessionId))
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      ws.onopen = () => {
        if (phaseRef.current === 'connecting' || phaseRef.current === 'reconnecting') {
          setPhaseBoth('recording')
        }
      }
      ws.onmessage = (event) => handleEvent(event.data)
      ws.onerror = () => {
        // Whatever went wrong arrives through onclose (with a code) or already
        // arrived as an error event; nothing to do here.
      }
      ws.onclose = (event) => {
        if (deliveredRef.current) {
          return
        }
        const current = phaseRef.current
        if (current !== 'connecting' && current !== 'recording' && current !== 'reconnecting' && current !== 'finalizing') {
          return
        }
        if (event.code && event.code !== 1000 && event.code !== 1005) {
          detailRef.current = detailRef.current || `close ${event.code}${event.reason ? `: ${event.reason}` : ''}`
        }
        if (current === 'connecting') {
          // Nothing was captured yet: report it rather than silently retrying.
          fail('unavailable', detailRef.current)
          return
        }
        const decision = onUpstreamLost({
          phase: current === 'finalizing' ? 'finalizing' : 'recording',
          reconnects: reconnectsRef.current,
        })
        if (decision === 'reconnect') {
          reconnectRef.current()
          return
        }
        void finalize(transcriptText(transcriptRef.current))
      }
    },
    [fail, finalize, handleEvent, setPhaseBoth],
  )
  const reconnect = useCallback(async () => {
    reconnectsRef.current += 1
    setPhaseBoth('reconnecting')
    closeSocket()
    let session
    try {
      session = await openVoiceSession()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finish({
        text: transcriptText(transcriptRef.current).trim(),
        warning: 'interrupted',
        detail: detailRef.current || message,
      })
      return
    }
    maxSecondsRef.current = session.max_seconds || maxSecondsRef.current
    // The provider's rate, not ours: the capture has to match what the session
    // declared, or every model hears the wrong pitch.
    rateRef.current = session.audio_rate || rateRef.current
    if (phaseRef.current !== 'reconnecting') {
      // Cancelled while the new id was being minted.
      return
    }
    attachSocket(session.session_id)
  }, [attachSocket, closeSocket, finish, setPhaseBoth])
  useEffect(() => {
    reconnectRef.current = () => {
      void reconnect()
    }
  }, [reconnect])

  const stop = useCallback(() => {
    if (phaseRef.current === 'reconnecting') {
      // No socket to commit on; the transcript so far is what there is.
      void finalize(transcriptText(transcriptRef.current))
      return
    }
    if (phaseRef.current !== 'recording') {
      return
    }
    // Stop pushing audio but keep the socket: the transcript still has to come
    // back over it.
    stopCapture()
    setPhaseBoth('finalizing')
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'commit' }))
    }
    clearFinalizeTimer()
    finalizeTimerRef.current = window.setTimeout(() => {
      // The provider went quiet: keep what was already transcribed rather than
      // reporting a failure the user cannot do anything about.
      void finalize(transcriptText(transcriptRef.current))
    }, FINALIZE_TIMEOUT_MS)
  }, [clearFinalizeTimer, finalize, setPhaseBoth, stopCapture])

  const startCapture = useCallback(
    async (stream: MediaStream) => {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      let ctx: AudioContext
      try {
        // Asking the context for the session's rate makes the browser do the
        // resampling for us; browsers that ignore the request fall through to the
        // downsample below.
        ctx = new Ctor({ sampleRate: rateRef.current })
      } catch {
        ctx = new Ctor()
      }
      audioCtxRef.current = ctx
      const processor = ctx.createScriptProcessor(FRAME_SAMPLES, 1, 1)
      processorRef.current = processor
      // The microphone settings are read here rather than passed down: they are a
      // property of this device, and the panel that edits them sits in another
      // part of the tree. The gain node is what makes a quiet microphone audible
      // to the recogniser, in the float domain before anything is quantised.
      const { sink } = buildCaptureGraph(ctx, stream, readMicSettings(), processor)
      sinkRef.current = sink

      const frameRate = ctx.sampleRate
      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const input = event.inputBuffer.getChannelData(0)
        const samples =
          frameRate === rateRef.current ? new Float32Array(input) : downsampleTo(input, frameRate, rateRef.current)
        levelRef.current = levelOf(samples)
        const frame = floatToPcm16(samples)
        // Keep the frame for the batch pass: the socket cannot replay, and the
        // batch model needs the whole take.
        framesRef.current.push(frame)
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(frame)
        }
      }

      setPhaseBoth('recording')
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      tickRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current
        setElapsedMs(elapsed)
        if (elapsed >= maxSecondsRef.current * 1000) {
          // The platform's ceiling for one dictation, counted across a
          // reconnect as well: stop and deliver what was said.
          stop()
        }
      }, 200)
    },
    [setPhaseBoth, stop],
  )

  // The connection-bring-up, shared by the first attempt and by a reconnect.
  const connect = useCallback(async () => {
    setPhaseBoth('connecting')
    let session
    try {
      session = await openVoiceSession()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setPhaseBoth('idle')
      optionsRef.current.onError(
        /not configured|not_configured|disabled|503/i.test(message) ? 'not_configured' : 'unavailable',
        message,
      )
      return
    }
    maxSecondsRef.current = session.max_seconds || maxSecondsRef.current

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: captureConstraints(readMicSettings()),
      })
    } catch {
      setPhaseBoth('idle')
      optionsRef.current.onError('mic_denied')
      return
    }
    streamRef.current = stream
    if (phaseRef.current !== 'connecting') {
      stream.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      return
    }
    attachSocket(session.session_id)
    await startCapture(stream)
  }, [attachSocket, setPhaseBoth, startCapture])

  const start = useCallback(() => {
    if (phaseRef.current !== 'idle') {
      return
    }
    if (!voiceSupported()) {
      optionsRef.current.onError('unsupported')
      return
    }
    deliveredRef.current = false
    reconnectsRef.current = 0
    detailRef.current = ''
    // A new take owns the buffer: whatever was kept for a manual re-run is gone.
    framesRef.current = []
    setCanRefine(false)
    transcriptRef.current = emptyTranscript()
    setTranscript('')
    setElapsedMs(0)
    void connect()
  }, [connect])

  const cancel = useCallback(() => {
    if (phaseRef.current === 'idle') {
      return
    }
    // A pass in flight is abandoned rather than awaited: the composer keeps the
    // text it already has, and the box becomes editable again.
    abortRef.current?.abort()
    deliveredRef.current = true
    finalizingRef.current = false
    teardown()
    transcriptRef.current = emptyTranscript()
    setTranscript('')
    setElapsedMs(0)
    setPhaseBoth('idle')
  }, [setPhaseBoth, teardown])

  /**
   * refine re-runs the batch pass on the take that is still buffered — the
   * manual trigger's entry point. The composer offers it; the platform's model
   * answers it.
   */
  const refine = useCallback(() => {
    if (
      phaseRef.current !== 'idle' ||
      !keepsAudioForManualRefine(optionsRef.current.batch, framesRef.current.length)
    ) {
      return
    }
    // Delivering a second result is the whole point here, so the latch reopens.
    deliveredRef.current = false
    setCanRefine(false)
    void (async () => {
      const batch = optionsRef.current.batch
      const refined = await batchPass()
      if (refined.aborted) {
        deliveredRef.current = true
        setPhaseBoth('idle')
        return
      }
      if (!refined.text) {
        // Nothing to put in the box: say so rather than clearing what is there.
        deliveredRef.current = true
        setPhaseBoth('idle')
        optionsRef.current.onError(refined.warning === 'batch_unavailable' ? 'batch_unavailable' : 'batch_failed')
        return
      }
      await deliver(refined.text, undefined, batch.skipAfterBatch)
    })()
  }, [batchPass, deliver, setPhaseBoth])

  useEffect(() => () => teardown(), [teardown])

  return { phase, transcript, elapsedMs, levelRef, start, stop, cancel, refine, canRefine }
}
