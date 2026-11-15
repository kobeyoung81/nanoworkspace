// Reading a capture frame's loudness, for the microphone test.
//
// dBFS is the unit a microphone's level is actually discussed in: 0 dBFS is the
// loudest a 16-bit sample can be, and speech that reaches the recogniser at
// -35 dBFS is quiet enough to lose words. Pure functions, so the numbers the test
// panel shows are testable.

/** CLIP_THRESHOLD is where a sample is no longer representable as 16-bit audio. */
export const CLIP_THRESHOLD = 0.98

/** FLOOR_DB is the quiet end the meter draws, not a physical limit. */
export const FLOOR_DB = -60

/** peakDb reports the loudest sample in dBFS; silence is -Infinity. */
export function peakDb(samples: Float32Array): number {
  let peak = 0
  for (const sample of samples) {
    const magnitude = Math.abs(sample)
    if (magnitude > peak) {
      peak = magnitude
    }
  }
  return toDb(peak)
}

/** rmsDb reports the average power in dBFS, which tracks perceived loudness. */
export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) {
    return Number.NEGATIVE_INFINITY
  }
  let sum = 0
  for (const sample of samples) {
    sum += sample * sample
  }
  return toDb(Math.sqrt(sum / samples.length))
}

/** clipping reports samples at or above the 16-bit ceiling: gain is too high. */
export function clipping(samples: Float32Array, threshold = CLIP_THRESHOLD): boolean {
  for (const sample of samples) {
    if (Math.abs(sample) >= threshold) {
      return true
    }
  }
  return false
}

/** levelPercent maps dBFS onto the meter's 0..1 bar. */
export function levelPercent(db: number): number {
  if (!Number.isFinite(db)) {
    return 0
  }
  const span = -FLOOR_DB
  const percent = ((db - FLOOR_DB) / span) * 100
  return Math.max(0, Math.min(100, percent))
}

/** formatDb renders a level for the panel ("-12.3 dB", "-∞"). */
export function formatDb(db: number): string {
  if (!Number.isFinite(db)) {
    return '−∞'
  }
  return `${db.toFixed(1)} dB`
}

function toDb(amplitude: number): number {
  if (amplitude <= 0) {
    return Number.NEGATIVE_INFINITY
  }
  return 20 * Math.log10(amplitude)
}
