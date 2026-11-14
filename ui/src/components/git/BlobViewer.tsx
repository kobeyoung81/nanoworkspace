import { useEffect, useState, type ChangeEvent } from 'react'
import { Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../lib/toast'
import { readBlob, writeBlob } from '../../lib/gitApi'
import { Button } from '../../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog'
import { Skeleton } from '../../ui/skeleton'
import { Textarea } from '../../ui/textarea'

export type BlobViewerProps = {
  agentId: string
  path: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

export function BlobViewer({ agentId, path, name, open, onOpenChange, onChanged }: BlobViewerProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    // Resetting loading state when a new file is opened is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    readBlob(agentId, path)
      .then((data) => setContent(data))
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [open, agentId, path])

  const save = async () => {
    setSaving(true)
    try {
      await writeBlob(agentId, path, content)
      toast.success(t('files.saved'))
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">{name}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setContent(event.target.value)}
              className="h-full min-h-0 w-full resize-none font-mono text-xs"
              spellCheck={false}
            />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={loading || saving}>
            {saving ? t('common.saving') : <><Save className="mr-1 h-3.5 w-3.5" />{t('common.save')}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}