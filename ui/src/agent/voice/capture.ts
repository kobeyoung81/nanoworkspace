// The microphone capture graph, shared by the dictation recorder and the
// settings panel's test run so the two cannot drift apart.
//
// The gain lives here, in the float domain and before the samples are quantised
// to 16 bit: quantising first and amplifying later would only amplify the
// quantisation noise. It also means the level meter downstream shows what the
// recogniser actually receives.

import type { MicSettings } from '../lib/micSettings'

/** captureConstraints turns the stored settings into getUserMedia constraints. */
export function captureConstraints(settings: MicSettings): MediaTrackConstraints {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: 1,
  }
}

export type CaptureGraph = {
  source: MediaStreamAudioSourceNode
  /** The microphone gain node the settings control. */
  gain: GainNode
  /** A silent sink: it keeps the graph pulling without echoing the mic back. */
  sink: GainNode
}

/**
 * buildCaptureGraph builds source → gain → (tap) → sink. The caller's tap — the
 * recorder's frame processor, the test panel's level reader — sits after the gain,
 * so everything downstream sees the amplified signal.
 */
export function buildCaptureGraph(
  ctx: AudioContext,
  stream: MediaStream,
  settings: MicSettings,
  tap?: AudioNode,
): CaptureGraph {
  const source = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain()
  gain.gain.value = settings.gain
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(gain)
  if (tap) {
    gain.connect(tap)
    tap.connect(sink)
  } else {
    gain.connect(sink)
  }
  sink.connect(ctx.destination)
  return { source, gain, sink }
}
