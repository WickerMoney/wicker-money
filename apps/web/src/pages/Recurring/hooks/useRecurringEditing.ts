import { useCallback, useState, type RefObject } from 'react'
import { formErrorsFrom, useFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { RecurringItem } from '../../../models/index.js'
import { draftFromItem, emptyDraft, fieldForPath, payloadFromDraft } from '../helpers/draft.js'
import type { RecurringDraft } from '../state/RecurringDraft.js'

/** What {@link useRecurringEditing} returns. */
export interface RecurringEditing {
  readonly draft: RecurringDraft
  /** `true` while the add/edit dialog is showing. */
  readonly open: boolean
  /** The item being edited, or `null` when the form adds a new one. */
  readonly editing: RecurringItem | null
  /** What is wrong with the form, by field (see `checkDraft`), and anything else for beside its button. */
  readonly errors: FormErrors
  /** Attach to the `<form>`, so focus can move to the first problem. */
  readonly formRef: RefObject<HTMLFormElement | null>
  readonly change: (patch: Partial<RecurringDraft>) => void
  readonly edit: (item: RecurringItem) => void
  /** Opens the dialog on a new, blank item. */
  readonly startAdd: () => void
  /** Closes the dialog and clears the form back to a new, blank item. */
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
  const [open, setOpen] = useState(false)
  const form = useFormErrors()
  const { clear: clearErrors, clearField } = form

  const change = useCallback((patch: Partial<RecurringDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    for (const field of Object.keys(patch)) clearField(field)
    // Income rows are one array; editing any row clears the rows' messages.
    patch.splits?.forEach((_, i) => { clearField(`splits.${i}.accountId`); clearField(`splits.${i}.amount`) })
  }, [clearField])

  const reset = useCallback(() => {
    setOpen(false)
    setEditing(null)
    setDraft(emptyDraft(today, defaultAccountId))
    clearErrors()
  }, [today, defaultAccountId, clearErrors])

  const startAdd = useCallback(() => {
    setEditing(null)
    setDraft(emptyDraft(today, defaultAccountId))
    clearErrors()
    showNotice(null)
    setOpen(true)
  }, [today, defaultAccountId, showNotice, clearErrors])

  const edit = useCallback((item: RecurringItem) => {
    setOpen(true)
    setEditing(item)
    setDraft(draftFromItem(item))
    clearErrors()
    showNotice(null)
  }, [showNotice, clearErrors])

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
    if ('errors' in built) { form.show(built.errors); return }
    form.clear()
    status.begin()
    try {
      if (editing === null) {
        await api.post('/recurring-items', built.payload)
      } else {
        await api.put(`/recurring-items/${editing.id}`, built.payload)
      }
      const verb = editing === null ? 'Added' : 'Updated'
      reset()
      showNotice(`${verb} '${built.payload.name}'.`)
      await reload()
    } catch (e) {
      // On the field the API names; a rule about the item as a whole (legs
      // that do not cancel out, say) goes beside the button.
      form.show(formErrorsFrom(e, fieldForPath(draft), 'Could not save the change.'))
    } finally { status.end() }
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

  return { draft, open, editing, errors: form.errors, formRef: form.ref, change, edit, startAdd, reset, save, end, remove }
}
