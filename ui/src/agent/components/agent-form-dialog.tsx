import { useState } from 'react'
import { toast } from '../lib/toast'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { FormField } from './ui/form-field'
import { createAgent, updateAgent, type AgentDetail, type AgentInput, type UserSummary } from '../lib/api'
import type { AgentGroup } from '../lib/agentGroups'

// Radix Select cannot use an empty string as a value, so "no group" travels as
// a sentinel and is turned back into "" on submit.
const UNGROUPED_VALUE = '__ungrouped__'

export function AgentFormDialog({
  open,
  onOpenChange,
  agent,
  users,
  showUserPicker,
  defaultUserId,
  groups,
  defaultGroupID,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent?: AgentDetail | null
  users?: UserSummary[]
  showUserPicker: boolean
  defaultUserId?: string
  groups?: AgentGroup[]
  /** Preselected group for a create started from a group menu. */
  defaultGroupID?: string
  onSaved: () => void
}) {
  // The dialog is remounted via a changing `key` whenever it (re)opens, so
  // these initializers are always evaluated with the latest agent/defaults.
  const [name, setName] = useState(() => agent?.display_name ?? '')
  const [userId, setUserId] = useState(() => agent?.user_id ?? defaultUserId ?? users?.[0]?.user_id ?? '')
  const [groupID, setGroupID] = useState(() => agent?.group_id ?? defaultGroupID ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError(t('agentForm.nameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: AgentInput = {
        display_name: name.trim(),
        // An empty string is meaningful: for an update it moves the agent out
        // of its group; on create it is simply ungrouped.
        group_id: groupID,
      }
      // Always attach the owner when known so self-service creation works for
      // operator/admin accounts too (the server otherwise leaves it empty).
      if (userId) {
        input.user_id = userId
      }
      if (agent) {
        await updateAgent(agent.id, input)
        toast.success(t('agentForm.agentUpdated'))
      } else {
        await createAgent(input)
        toast.success(t('agentForm.agentCreated'))
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('agentForm.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{agent ? t('agentForm.editTitle', { name: agent.display_name || t('agent.agentFallback') }) : t('agentForm.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormField label={t('auth.displayName')} error={error ?? undefined}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('agentForm.namePlaceholder')} />
          </FormField>

          <FormField label={t('agentForm.group')} hint={t('agentForm.groupHint')}>
            <Select
              value={groupID || UNGROUPED_VALUE}
              onValueChange={(value) => setGroupID(value === UNGROUPED_VALUE ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNGROUPED_VALUE}>{t('agentForm.ungrouped')}</SelectItem>
                {(groups ?? []).map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {showUserPicker ? (
            <FormField label={t('agentForm.owner')} hint={t('agentForm.ownerHint')}>
              <Select value={userId} onValueChange={setUserId} disabled={!!agent}>
                <SelectTrigger>
                  <SelectValue placeholder={t('files.pickUser')} />
                </SelectTrigger>
                <SelectContent>
                  {(users ?? []).map((user) => (
                    <SelectItem key={user.user_id} value={user.user_id}>
                      {user.display_name || user.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : agent ? t('agentForm.saveChanges') : t('agentForm.createAgent')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
