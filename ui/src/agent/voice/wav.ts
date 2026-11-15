// Turning the buffered capture into a file the batch pass can carry.
//
// The socket streams 24 kHz PCM16 to the realtime layer. The batch model wants a
// file, and speech models expect 16 kHz, so the buffer is halved on the way out —
// the same averaging the capture path already uses when a browser ignores the
// requested rate (voice/pcm.ts downsampleTo). Nothing here touches the DOM, so it
// is testable.

/** REFINE_RATE is the rate the batch upload carries: what speech models expect. */
export const REFINE_RATE = 16000

/** framesToWav joins PCM16 chunks, resamples and writes a WAV file. */
export function framesToWav(frames: Uint8Array<ArrayBuffer>[], from: number, to: number): Blob {
  const joined = joinFrames(frames)
  return wavFromPcm16(resamplePcm16(joined, from, to), to)
}

/** wavFromPcm16 wraps little-endian PCM16 samples in a RIFF/WAVE header. */
export function wavFromPcm16(pcm: Uint8Array<ArrayBuffer>, rate: number): Blob {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeText(36, 'data')
  view.setUint32(40, pcm.length, true)
  return new Blob([header, pcm], { type: 'audio/wav' })
}

function joinFrames(frames: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  let length = 0
  for (const frame of frames) {
    length += frame.length
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const frame of frames) {
    out.set(frame, offset)
    offset += frame.length
  }
  return out
}

/**
 * resamplePcm16 averages each output sample's input window. Averaging low-passes
 * on the way down, which is what keeps high frequencies from folding back into
 * the band the model reads.
 */
export function resamplePcm16(pcm: Uint8Array<ArrayBuffer>, from: number, to: number): Uint8Array<ArrayBuffer> {
  const total = Math.floor(pcm.length / 2)
  if (from === to) {
    return pcm
  }
  if (from <= 0 || to <= 0 || total === 0) {
    // Without both rates there is nothing to resample to; an empty result is
    // better than handing back audio the caller believes is at another rate.
    return new Uint8Array(0)
  }
  const length = Math.floor((total * to) / from)
  if (length <= 0) {
    return new Uint8Array(0)
  }
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const out = new Uint8Array(length * 2)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < length; i++) {
    const start = Math.floor((i * from) / to)
    const end = Math.min(total, Math.max(start + 1, Math.floor(((i + 1) * from) / to)))
    let sum = 0
    for (let j = start; j < end; j++) {
      sum += view.getInt16(j * 2, true)
    }
    outView.setInt16(i * 2, Math.round(sum / (end - start)), true)
  }
  return out
}
