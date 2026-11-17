// What a preview renderer needs from the browser, checked before it runs.
//
// The libraries are shipped prebuilt and cannot be transpiled further, so an
// engine that lacks one of these APIs fails somewhere deep inside a parser. A
// named, up-front answer ("this browser is missing X") is far more useful than
// a blank panel — and it is the only part of the compatibility story JS can
// control, since none of these are polyfillable in practice.

export type PreviewKind = 'pdf' | 'docx' | 'pptx' | 'xlsx'

export type SupportEnv = {
  worker: boolean
  resizeObserver: boolean
  intersectionObserver: boolean
  canvasRoundRect: boolean
  structuredClone: boolean
  fontFace: boolean
}

export function detectSupportEnv(): SupportEnv {
  let roundRect = false
  if (typeof document !== 'undefined') {
    const context = document.createElement('canvas').getContext('2d') as
      | (CanvasRenderingContext2D & { roundRect?: unknown })
      | null
    roundRect = typeof context?.roundRect === 'function'
  }
  return {
    worker: typeof Worker !== 'undefined',
    resizeObserver: typeof ResizeObserver !== 'undefined',
    intersectionObserver: typeof IntersectionObserver !== 'undefined',
    canvasRoundRect: roundRect,
    // `structuredClone` is a global function, not a property of window in older typings.
    structuredClone: typeof globalThis.structuredClone === 'function',
    fontFace: typeof FontFace !== 'undefined',
  }
}

// missingPreviewApis lists the engine features this renderer cannot do without.
// Names are stable identifiers, not translated text: they are shown to the user
// so a bug report can say which one is absent.
export function missingPreviewApis(kind: PreviewKind, env: SupportEnv): string[] {
  const missing: string[] = []
  if (kind === 'pdf' && !env.worker) {
    // pdf.js 5 loads its parser in a module worker.
    missing.push('Worker')
  }
  if (kind === 'pptx') {
    if (!env.resizeObserver) {
      missing.push('ResizeObserver')
    }
    if (!env.intersectionObserver) {
      missing.push('IntersectionObserver')
    }
    if (!env.canvasRoundRect) {
      missing.push('CanvasRenderingContext2D.roundRect')
    }
    if (!env.structuredClone) {
      missing.push('structuredClone')
    }
    if (!env.fontFace) {
      missing.push('FontFace')
    }
  }
  return missing
}
