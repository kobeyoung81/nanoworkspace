// One fetch of the platform voice settings per page load.
//
// Every conversation tab renders its own composer, and each of them needs the
// same answer ("is dictation available, how long may it be, is polishing on").
// The promise is cached at module scope so opening tabs does not multiply the
// request; a platform config change is rare and a reload picks it up.

import { useEffect, useState } from 'react'
import { getVoiceConfig, type VoiceConfig } from './api'

let cached: Promise<VoiceConfig> | null = null

function loadVoiceConfig(): Promise<VoiceConfig> {
  if (!cached) {
    cached = getVoiceConfig().catch((err) => {
      // Do not poison the cache with a transient failure.
      cached = null
      throw err
    })
  }
  return cached
}

/** useVoiceConfig returns the platform settings, or null while unknown/unset. */
export function useVoiceConfig(): VoiceConfig | null {
  const [config, setConfig] = useState<VoiceConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadVoiceConfig()
      .then((value) => {
        if (!cancelled) {
          setConfig(value)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return config
}

/** resetVoiceConfigCache drops the memoised settings (tests, sign-out). */
export function resetVoiceConfigCache(): void {
  cached = null
}
