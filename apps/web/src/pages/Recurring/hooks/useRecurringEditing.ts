import { useCallback, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { RecurringItem } from '../../../models/index.js'
import { draftFromItem, emptyDraft, payloadFromDraft } from '../helpers/draft.js'
import type { RecurringDraft } from '../state/RecurringDraft.js'

/** What {@link useRecurringEditing} returns. */
export interface RecurringEditing {
  readonly draft: RecurringDraft
  /** The item being edited, or `null` when the form adds a new one. */
  readonly editing: RecurringItem | null
  readonly change: (patch: Partial<RecurringDraft>) => void
  readonly edit: (item: RecurringItem) => void
  /** Clears the form back to a new, blank item. */
  readonly reset: () => void
  readonly save: () => Promise<void>
  readonly end: (item: RecurringItem) => Promise<void>
  readonly remove: (item: RecurringItem) => Promise<void>
}

/**
 * The add/edit form and the per-row actions.
 *
 * @param status - Busy flag and error message shared with the page.
 * @param reload - Re-reads the list after a change.
 * @param today - The server's today, used as the default first date.
 * @param defaultAccountId - The account a new item pays from, or `''`.
 * @param showNotice - Shows a confirmation line on the page.
 * @returns Form state and actions.
 */
export function useRecurringEditing(
  status: ActionStatus,
  reload: () => Promise<void>,
  today: string,
  defaultAccountId: string,
  showNotice: (message: string | null) => void,
): RecurringEditing {
  const [draft, setDraft] = useState<RecurringDraft>(() => emptyDraft(today, defaultAccountId))
  const [editing, setEditing] = useState<RecurringItem | null>(null)

  const change = useCallback((patch: Partial<RecurringDraft>) => setDraft((d) => ({ ...d, ...patch })), [])

  const reset = useCallback(() => {
    setEditing(null)
    setDraft(emptyDraft(today, defaultAccountId))
  }, [today, defaultAccountId])

  const edit = useCallback((item: RecurringItem) => {
    setEditing(item)
    setDraft(draftFromItem(item))
    showNotice(null)
  }, [showNotice])

  const run = async (work: () => Promise<string>) => {
    status.begin()
    try {
      showNotice(await work())
      await reload()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not save the change.')
    } finally { status.end() }
  }

  const save = async () => {
    const built = payloadFromDraft(draft)
    if ('error' in built) { status.show(built.error); return }
    await run(async () => {
      if (editing === null) {
        await api.post('/recurring-items', built.payload)
      } else {
        await api.put(`/recurring-items/${editing.id}`, built.payload)
      }
      const verb = editing === null ? 'Added' : 'Updated'
      reset()
      return `${verb} '${built.payload.name}'.`
    })
  }

  const end = async (item: RecurringItem) => {
    if (!window.confirm(`End '${item.name}' today? Nothing after today will be expected. It stays under "Show ended".`)) return
    await run(async () => {
      await api.post(`/recurring-items/${item.id}/end`, {})
      if (editing?.id === item.id) reset()
      return `Ended '${item.name}'.`
    })
  }

  const remove = async (item: RecurringItem) => {
    if (!window.confirm(`Delete '${item.name}'? This cannot be undone. To stop it going forward but keep it, end it instead.`)) return
    await run(async () => {
      await api.del(`/recurring-items/${item.id}`)
      if (editing?.id === item.id) reset()
      return `Deleted '${item.name}'.`
    })
  }

  return { draft, editing, change, edit, reset, save, end, remove }
}
