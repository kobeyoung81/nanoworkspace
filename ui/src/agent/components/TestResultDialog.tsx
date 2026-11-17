import { CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Badge } from './ui/badge'

export type ProbeResult = {
  ok: boolean
  latency_ms?: number
  error?: string
  models?: string[]
  reply?: string
  tools?: { name: string; description?: string }[]
  server_name?: string
  protocol_version?: string
}

// TestResultDialog renders the outcome of a "test connection" probe (model
// provider, model, or MCP server).
export function TestResultDialog({
  open,
  onOpenChange,
  title,
  result,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  result: ProbeResult | null
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {result?.ok ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            {title}
          </DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={result.ok ? 'secondary' : 'danger'}>
                {result.ok ? t('tests.success') : t('tests.failure')}
              </Badge>
              {result.latency_ms != null ? (
                <span className="text-xs text-muted-foreground">{t('tests.latency', { ms: result.latency_ms })}</span>
              ) : null}
              {result.server_name ? (
                <span className="text-xs text-muted-foreground">
                  {result.server_name}
                  {result.protocol_version ? ` · ${result.protocol_version}` : ''}
                </span>
              ) : null}
            </div>

            {!result.ok && result.error ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-2 text-xs text-destructive">
                {result.error}
              </pre>
            ) : null}

            {result.ok && result.reply != null ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t('tests.reply')}</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-2 text-xs">
                  {result.reply || t('tests.emptyReply')}
                </pre>
              </div>
            ) : null}

            {result.ok && result.models ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t('tests.models', { count: result.models.length })}
                </p>
                {result.models.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('tests.noModels')}</p>
                ) : (
                  <div className="flex max-h-48 flex-wrap gap-1 overflow-auto">
                    {result.models.map((m) => (
                      <Badge key={m} variant="outline" className="font-mono text-[11px]">
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {result.ok && result.tools ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t('tests.tools', { count: result.tools.length })}
                </p>
                {result.tools.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('tests.noTools')}</p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-auto">
                    {result.tools.map((tool) => (
                      <li key={tool.name} className="rounded border px-2 py-1">
                        <span className="font-mono text-xs font-medium">{tool.name}</span>
                        {tool.description ? (
                          <span className="ml-2 text-xs text-muted-foreground">{tool.description}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
