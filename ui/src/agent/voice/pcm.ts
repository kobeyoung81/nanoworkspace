// PCM plumbing for dictation.
//
// The capture path is: an AudioContext opened at the session's rate (the browser
// resamples the microphone for us) → float frames → PCM16 frames. The rate comes
// from the platform's realtime tier — 24 kHz is the OpenAI contract, a local
// model asks for 16 kHz — and TARGET_RATE below is only the fallback for a
// caller that has no opinion. Browsers that ignore the requested rate (iOS
// Safari) fall back to resampling here.

export const TARGET_RATE = 24000

/**
 * floatToPcm16 clamps -1..1 samples into little-endian signed 16-bit PCM, which
 * is the only audio format the realtime session takes.
 */
export function floatToPcm16(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(samples.length * 2))
  const view = new DataView(out.buffer)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    // 32767 for the positive side, 32768 for the negative: otherwise -1 and +1
    // would both land on the same code and clip.
    const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(i * 2, Math.round(scaled), true)
  }
  return out
}

/**
 * downsampleTo resamples by averaging each output sample's input window. It is
 * the fallback for a context that refused the 24 kHz request; the averaging also
 * keeps high frequencies from folding back into the band.
 */
export function downsampleTo(samples: Float32Array, from: number, to: number): Float32Array {
  if (from <= 0 || to <= 0 || samples.length === 0) {
    return new Float32Array(0)
  }
  if (from === to) {
    return samples.slice()
  }
  const length = Math.max(1, Math.floor((samples.length * to) / from))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor((i * from) / to)
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor(((i + 1) * from) / to)))
    let sum = 0
    for (let j = start; j < end; j++) {
      sum += samples[j]
    }
    out[i] = sum / (end - start)
  }
  return out
}

/**
 * levelOf reports 0..1 loudness for the recording meter (RMS, scaled so normal
 * speech lands in the middle of the range).
 */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0
  }
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  const rms = Math.sqrt(sum / samples.length)
  return Math.max(0, Math.min(1, rms * 3))
}
