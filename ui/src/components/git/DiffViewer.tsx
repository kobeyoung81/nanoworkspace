import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Columns, Rows } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { flattenHunkLines, parseUnifiedDiff, type DiffHunk } from '../../lib/diff'
import { Button } from '../../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog'

export type DiffViewerProps = {
  title: string
  raw: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DiffViewer({ title, raw, open, onOpenChange }: DiffViewerProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'unified' | 'split'>('unified')
  const [activeHunk, setActiveHunk] = useState(0)
  const parsed = useMemo(() => parseUnifiedDiff(raw), [raw])

  const hunks = useMemo<DiffHunk[]>(() => {
    const out: DiffHunk[] = []
    for (const file of parsed.files) {
      for (const hunk of file.hunks) {
        out.push({ ...hunk, lines: flattenHunkLines(hunk) })
      }
    }
    return out
  }, [parsed])

  const focusHunk = useCallback(
    (index: number) => {
      if (hunks.length === 0) {
        return
      }
      const next = Math.max(0, Math.min(index, hunks.length - 1))
      setActiveHunk(next)
      document.querySelector(`[data-hunk="${next}"]`)?.scrollIntoView({ block: 'center' })
    },
    [hunks],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    // Reset the diff cursor when a new diff is opened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveHunk(0)
    setMode('unified')
  }, [open, title])

  useEffect(() => {
    // Restore scroll to the active hunk whenever the dialog opens.
    if (open) {
      const id = window.setTimeout(() => focusHunk(0), 50)
      return () => window.clearTimeout(id)
    }
  }, [open, focusHunk])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'n' || event.key === 'N' || event.key === 'F3') {
      if (!event.shiftKey) {
        event.preventDefault()
        focusHunk(activeHunk + 1)
      } else {
        event.preventDefault()
        focusHunk(activeHunk - 1)
      }
    } else if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      focusHunk(activeHunk - 1)
    } else if (event.key === 'Escape') {
      onOpenChange(false)
    }
  }

  if (parsed.files.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{title}</DialogTitle>
          </DialogHeader>
          <p className="py-8 text-center text-sm text-muted-foreground">{t('gitBrowser.diff.noChanges')}</p>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] max-w-4xl flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <DialogTitle className="truncate text-sm">{title}</DialogTitle>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant={mode === 'unified' ? 'outline' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setMode('unified')}
                aria-label={t('gitBrowser.diff.unified')}
                title={t('gitBrowser.diff.unified')}
              >
                <Rows className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={mode === 'split' ? 'outline' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setMode('split')}
                aria-label={t('gitBrowser.diff.split')}
                title={t('gitBrowser.diff.split')}
              >
                <Columns className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => focusHunk(activeHunk - 1)} aria-label={t('gitBrowser.diff.prevHunk')}>
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => focusHunk(activeHunk + 1)} aria-label={t('gitBrowser.diff.nextHunk')}>
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Hunk overview strip */}
          {hunks.length > 1 ? (
            <div className="mt-2 flex items-center gap-1">
              {hunks.map((hunk, index) => (
                <button
                  key={`${hunk.newStart}-${index}`}
                  type="button"
                  className={cn(
                    'h-1.5 flex-1 rounded-full',
                    index === activeHunk ? 'bg-primary' : 'bg-muted hover:bg-muted-foreground/30',
                  )}
                  onClick={() => focusHunk(index)}
                  aria-label={`${t('gitBrowser.diff.hunk')} ${index + 1}`}
                />
              ))}
              <span className="ml-2 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {activeHunk + 1}/{hunks.length}
              </span>
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto font-mono text-xs" onKeyDown={onKeyDown} tabIndex={0}>
          {mode === 'split' ? (
            <SplitView parsed={parsed} />
          ) : (
            <UnifiedView parsed={parsed} activeHunk={activeHunk} onHunkClick={setActiveHunk} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function lineClass(type: string): string {
  if (type === '+') {
    return 'bg-success/10'
  }
  if (type === '-') {
    return 'bg-destructive/10'
  }
  if (type === '\\') {
    return 'text-muted-foreground'
  }
  return ''
}

function UnifiedView({
  parsed,
  activeHunk,
  onHunkClick,
}: {
  parsed: ReturnType<typeof parseUnifiedDiff>
  activeHunk: number
  onHunkClick: (index: number) => void
}) {
  let hunkIndex = -1
  const rows: { hunk: number; type: string; text: string }[] = []
  for (const file of parsed.files) {
    if (file.binary) {
      rows.push({ hunk: -1, type: '', text: `Binary file: ${file.newPath || file.oldPath}` })
      continue
    }
    for (const hunk of file.hunks) {
      hunkIndex += 1
      rows.push({ hunk: hunkIndex, type: '@', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}` })
      for (const line of hunk.lines) {
        rows.push({ hunk: hunkIndex, type: line.type, text: line.text })
      }
    }
  }
  return (
    <pre className="p-2">
      {rows.map((row, index) => (
        <div
          key={index}
          data-hunk={row.hunk}
          onClick={() => row.hunk >= 0 && onHunkClick(row.hunk)}
          className={cn(
            'flex whitespace-pre-wrap break-all px-2',
            lineClass(row.type),
            row.hunk === activeHunk && row.hunk >= 0 && 'outline outline-1 outline-primary/40',
            row.type === '@' && 'bg-primary/10 font-semibold text-primary',
          )}
        >
          {row.text === '' ? '\u00A0' : row.text}
        </div>
      ))}
    </pre>
  )
}

function SplitView({ parsed }: { parsed: ReturnType<typeof parseUnifiedDiff> }) {
  return (
    <pre className="p-2">
      {parsed.files.map((file, fileIndex) => (
        <div key={fileIndex} className="mb-2">
          <div className="px-2 text-[11px] font-semibold text-primary">{file.newPath || file.oldPath}</div>
          {file.binary ? <div className="px-2 text-muted-foreground">Binary file</div> : null}
          {file.hunks.map((hunk, hunkIndex) => {
            // Build left/right columns.
            const left: { type: string; text: string }[] = []
            const right: { type: string; text: string }[] = []
            for (const line of hunk.lines) {
              if (line.type === '+') {
                right.push(line)
                left.push({ type: '', text: '' })
              } else if (line.type === '-') {
                left.push(line)
                right.push({ type: '', text: '' })
              } else if (line.type === '\\') {
                left.push(line)
                right.push(line)
              } else {
                left.push(line)
                right.push(line)
              }
            }
            const count = Math.max(left.length, right.length)
            const rows: { left: { type: string; text: string }; right: { type: string; text: string } }[] = []
            for (let i = 0; i < count; i++) {
              rows.push({
                left: left[i] ?? { type: '', text: '' },
                right: right[i] ?? { type: '', text: '' },
              })
            }
            return (
              <div key={hunkIndex} className="flex border-b border-border/50">
                <div className="w-1/2 border-r">
                  {rows.map((row, i) => (
                    <div key={`l-${i}`} className={cn('flex whitespace-pre-wrap break-all px-2', lineClass(row.left.type))}>
                      {row.left.text === '' ? '\u00A0' : row.left.text}
                    </div>
                  ))}
                </div>
                <div className="w-1/2">
                  {rows.map((row, i) => (
                    <div key={`r-${i}`} className={cn('flex whitespace-pre-wrap break-all px-2', lineClass(row.right.type))}>
                      {row.right.text === '' ? '\u00A0' : row.right.text}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </pre>
  )
}