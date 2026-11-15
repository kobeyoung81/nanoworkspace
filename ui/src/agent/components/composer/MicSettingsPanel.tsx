// The microphone page of the composer's settings menu.
//
// The capture settings belong to the device, not to the platform: a phone in a
// quiet room and a laptop beside a fan want different numbers. They live in client
// state (per account, this browser), and are written as they change — there is no
// page to submit.
//
// The test button opens the microphone with the values *on screen*, saved or not,
// and shows the level they produce: a gain control you cannot hear is one you set
// blind. Nothing is recorded, and nothing leaves the browser.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { cn } from '../../lib/utils'
import { clipping, formatDb, levelPercent, peakDb, rmsDb } from '../../lib/micLevel'
import {
  DEFAULT_MIC_SETTINGS,
  MAX_GAIN,
  MIN_GAIN,
  clampGain,
  readMicSettings,
  writeMicSettings,
  type MicSettings,
} from '../../lib/micSettings'
import { buildCaptureGraph, captureConstraints } from '../../voice/capture'

/** How long one test run listens, and how often the reading is refreshed. */
const TEST_MS = 5000
const METER_INTERVAL_MS = 80
/** Sample window per reading: enough to be steady, short enough to feel live. */
const METER_FRAME = 2048

export function MicSettingsPanel() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<MicSettings>(() => readMicSettings())
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [peak, setPeak] = useState<number | null>(null)
  const [rms, setRms] = useState<number | null>(null)
  const [clipped, setClipped] = useState(false)

  // The audio callback and the timer below read the current form value through a
  // ref instead of closing over one render.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  })

  // stopRef holds the teardown of the run in flight, so the button, the timer and
  // unmounting all take one path.
  const stopRef = useRef<() => void>(() => {})
  const runningRef = useRef(false)

  const update = useCallback((patch: Partial<MicSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      writeMicSettings(next)
      return next
    })
  }, [])

  const runTest = useCallback(async () => {
    if (runningRef.current) {
      stopRef.current()
      return
    }
    setError(null)
    setPeak(null)
    setRms(null)
    setClipped(false)

    const mic = settingsRef.current
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: captureConstraints(mic) })
    } catch {
      setError(t('composer.mic.denied'))
      return
    }

    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctor()
    const processor = ctx.createScriptProcessor(METER_FRAME, 1, 1)
    const { source, gain, sink } = buildCaptureGraph(ctx, stream, mic, processor)

    // The reading accumulates between refreshes: the audio callback runs far more
    // often than the meter needs to repaint.
    let loudest = Number.NEGATIVE_INFINITY
    let average = Number.NEGATIVE_INFINITY
    let over = false
    processor.onaudioprocess = (event) => {
      const frame = event.inputBuffer.getChannelData(0)
      loudest = Math.max(loudest, peakDb(frame))
      average = rmsDb(frame)
      if (!over && clipping(frame)) {
        over = true
      }
    }

    const timer = window.setInterval(() => {
      setPeak(loudest === Number.NEGATIVE_INFINITY ? loudest : loudest)
      setRms(average)
      setClipped(over)
    }, METER_INTERVAL_MS)

    const stop = () => {
      window.clearInterval(timer)
      processor.onaudioprocess = null
      processor.disconnect()
      source.disconnect()
      gain.disconnect()
      sink.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close().catch(() => {})
      runningRef.current = false
      setTesting(false)
    }
    stopRef.current = stop
    runningRef.current = true
    setTesting(true)
    window.setTimeout(() => {
      if (runningRef.current) {
        stop()
      }
    }, TEST_MS)
  }, [t])

  useEffect(() => () => stopRef.current(), [])

  const switches = [
    { key: 'autoGainControl' as const, label: t('composer.mic.agc'), hint: t('composer.mic.agcHint') },
    { key: 'noiseSuppression' as const, label: t('composer.mic.ns'), hint: t('composer.mic.nsHint') },
    { key: 'echoCancellation' as const, label: t('composer.mic.ec'), hint: t('composer.mic.ecHint') },
  ]

  return (
    // The panel scrolls rather than growing: on a phone the popover has little
    // room above the composer, and a card that runs off the screen is worse than
    // one you scroll. The rows below keep min-w-0/shrink-0 so a long hint wraps
    // instead of squeezing the switch off the edge.
    <div
      className="max-h-[55vh] space-y-3 overflow-y-auto overscroll-contain p-3"
      data-mic-settings=""
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">{t('composer.mic.gain')}</span>
          <span className="text-right text-xs tabular-nums text-foreground">
            ×{settings.gain.toFixed(2)} · {settings.gain >= 1 ? '+' : ''}
            {(20 * Math.log10(settings.gain)).toFixed(1)} dB
          </span>
        </div>
        <input
          type="range"
          min={MIN_GAIN}
          max={MAX_GAIN}
          step={0.25}
          value={settings.gain}
          aria-label={t('composer.mic.gain')}
          onChange={(event) => update({ gain: clampGain(Number(event.target.value)) })}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
        <p className="text-[11px] text-muted-foreground">{t('composer.mic.gainHint')}</p>
      </div>

      {switches.map(({ key, label, hint }) => (
        <div key={key} className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
          </div>
          <Switch
            className="shrink-0"
            checked={settings[key]}
            onCheckedChange={(value) => update({ [key]: value })}
          />
        </div>
      ))}

      <div className="space-y-1.5 border-t pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={testing ? 'secondary' : 'outline'} onClick={() => void runTest()}>
            {testing ? t('composer.mic.testing') : t('composer.mic.test')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => update({ ...DEFAULT_MIC_SETTINGS })}>
            {t('composer.mic.reset')}
          </Button>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label={t('composer.mic.level')}
          aria-valuenow={peak === null ? 0 : Math.round(levelPercent(peak))}
          aria-valuemin={0}
          aria-valuemax={100}
          data-mic-meter={peak === null ? '' : 'active'}
        >
          <div
            className={cn('h-full rounded-full transition-[width] duration-75', clipped ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${peak === null ? 0 : levelPercent(peak)}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
          <span>
            {t('composer.mic.level')}: {peak === null ? '—' : formatDb(peak)}
            {rms === null ? '' : ` / ${formatDb(rms)}`}
          </span>
          {clipped ? <span className="font-medium text-destructive">{t('composer.mic.clipping')}</span> : null}
        </div>
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
