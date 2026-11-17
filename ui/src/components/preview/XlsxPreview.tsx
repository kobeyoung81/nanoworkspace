import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SHEET_ROW_LIMIT, sheetWindow } from '../../lib/binaryPreview'
import { cellKey, mergeLayout, type CellRange, type MergeLayout } from '../../lib/sheetLayout'
import { cn } from '../../lib/utils'

type ParsedSheet = {
  name: string
  rows: string[][]
  truncated: boolean
  layout: MergeLayout
}

// XlsxPreview shows the data of every sheet: values, merged cells and the sheet
// tabs. Cell formatting (fonts, colours, column widths) is not parsed by the
// community edition of the library, so it is not what this view claims to show.
export function XlsxPreview({ blob }: { blob: Blob }) {
  const { t } = useTranslation()
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const XLSX = await import('@e965/xlsx')
        const workbook = XLSX.read(new Uint8Array(await blob.arrayBuffer()), {
          type: 'array',
          // Without this a date cell arrives as its serial number.
          cellDates: true,
        })
        const parsed = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name]
          const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: false,
            defval: '',
            blankrows: false,
          })
          const rows = raw.map((row) =>
            Array.isArray(row) ? row.map((cell) => (cell == null ? '' : String(cell))) : [],
          )
          const windowed = sheetWindow(rows)
          const merges = (sheet['!merges'] ?? []) as CellRange[]
          return {
            name,
            rows: windowed.rows,
            truncated: windowed.truncated,
            layout: mergeLayout(merges, windowed.rows.length),
          }
        })
        if (!cancelled) {
          setSheets(parsed)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [blob])

  if (error) {
    return <p className="p-4 text-sm text-destructive">{error}</p>
  }
  if (!sheets) {
    return <p className="p-4 text-sm text-muted-foreground">{t('files.previewLoading')}</p>
  }
  const sheet = sheets[Math.min(active, sheets.length - 1)]
  if (!sheet) {
    return <p className="p-4 text-sm text-muted-foreground">{t('files.previewLoading')}</p>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
        {sheets.map((item, index) => (
          <button
            key={item.name}
            type="button"
            onClick={() => setActive(index)}
            className={cn(
              'max-w-[16rem] truncate rounded px-2 py-1 text-xs transition-colors',
              index === active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {item.name || t('files.sheet', { index: index + 1 })}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <table className="border-collapse text-xs">
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={cn(rowIndex % 2 === 1 && 'bg-muted/40')}>
                <th className="sticky left-0 border bg-background px-2 py-0.5 text-right font-mono text-[10px] text-muted-foreground">
                  {rowIndex + 1}
                </th>
                {row.map((cell, colIndex) => {
                  const key = cellKey(rowIndex, colIndex)
                  if (sheet.layout.covered.has(key)) {
                    return null
                  }
                  const span = sheet.layout.spans.get(key)
                  return (
                    <td
                      key={colIndex}
                      rowSpan={span?.rowSpan}
                      colSpan={span?.colSpan}
                      className="max-w-[24rem] whitespace-pre-wrap border px-2 py-0.5 align-top"
                    >
                      {cell}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet.truncated ? (
          <p className="p-2 text-xs text-muted-foreground">{t('files.sheetsTruncated', { limit: SHEET_ROW_LIMIT })}</p>
        ) : null}
      </div>
    </div>
  )
}
