import { describe, expect, it } from 'vitest'
import { heartbeatDue, needsProbeBeforeSend, probeTimedOut } from './chatLiveness'

describe('heartbeatDue', () => {
  it('is due once the socket has been quiet for the interval', () => {
    expect(heartbeatDue(15_000, 0)).toBe(true)
    expect(heartbeatDue(14_999, 0)).toBe(false)
    expect(heartbeatDue(20_000, 5_000)).toBe(true)
  })

  it('treats a clock that went backwards as due (one harmless probe)', () => {
    expect(heartbeatDue(1_000, 10_000)).toBe(true)
  })
})

describe('needsProbeBeforeSend', () => {
  it('sends straight away on a connection that just carried traffic', () => {
    expect(needsProbeBeforeSend(1_000, 0)).toBe(false)
    expect(needsProbeBeforeSend(9_999, 0)).toBe(false)
  })

  it('asks first after a quiet stretch', () => {
    expect(needsProbeBeforeSend(10_000, 0)).toBe(true)
    expect(needsProbeBeforeSend(30_000, 5_000)).toBe(true)
  })
})

describe('probeTimedOut', () => {
  it('ignores a probe that is not in flight', () => {
    expect(probeTimedOut(60_000, 0)).toBe(false)
  })

  it('times out after three seconds and not before', () => {
    expect(probeTimedOut(2_999, 1_000)).toBe(false)
    expect(probeTimedOut(4_000, 1_000)).toBe(true)
  })
})
