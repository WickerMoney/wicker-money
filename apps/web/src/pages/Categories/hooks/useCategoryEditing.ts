import { useState } from 'react'
import { NO_FORM_ERRORS, formErrorsFrom, hasFormErrors, useToast, type FormErrors } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import { checkText, fieldErrors } from '../../../lib/fieldChecks.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, CategoryUsage } from '../../../models/index.js'
import type { CategoryEdit } from '../state/CategoryEdit.js'
import type { CategoryEditing } from '../state/CategoryEditing.js'

/** The toast family for the category table, so the next action replaces the last. */
const TOAST_KEY = 'categories:row'

/**
 * Owns the category table's inline editing, enable/disable and delete.
 *
 * A saved edit, a disable or enable and a delete each say so in a toast, and a
 * refusal that no field owns is an error toast (ADR 0009). A refused edit stays
 * beside the row.
 *
 * @param status - Busy flag shared with the page.
 * @param onChanged - Called after any change so the list can be re-read.
 * @param onMovedUnder - Called with the parent a saved category now sits under, so
 *   the page can open it instead of leaving the row hidden in a collapsed group.
 * @returns The row being edited and the actions on rows.
 */
export function useCategoryEditing(
  status: ActionStatus, onChanged: () => Promise<void>, onMovedUnder?: (parentId: string) => void,
): CategoryEditing {
  const [editing, setEditing] = useState<CategoryEdit | null>(null)
  const [errors, setErrors] = useState<FormErrors>(NO_FORM_ERRORS)
  const toast = useToast()

  const start = (c: Category) => {
    setEditing({ id: c.id, name: c.name, parentId: c.parent_id ?? '', kind: c.kind })
    setErrors(NO_FORM_ERRORS)
  }

  const cancel = () => { setEditing(null); setErrors(NO_FORM_ERRORS) }

  const change = (next: CategoryEdit) => {
    if (next.name !== editing?.name) setErrors((e) => ({ ...e, fields: {} }))
    setEditing(next)
  }

  const save = async () => {
    if (editing === null) return
    const problems = fieldErrors({ name: checkText(editing.name, 100) })
    setErrors(problems)
    if (hasFormErrors(problems)) return
    status.begin()
    try {
      await api.patch(`/categories/${editing.id}`, {
        name: editing.name.trim(),
        parentId: editing.parentId === '' ? null : editing.parentId,
        kind: editing.kind,
      })
      setEditing(null)
      if (editing.parentId !== '') onMovedUnder?.(editing.parentId)
      await onChanged()
      toast.show(`Saved changes to '${editing.name.trim()}'.`, { kind: 'success', key: TOAST_KEY })
    } catch (e) {
      // Re-parenting refusals ("cannot be its own parent") are not about the
      // name, so they land beside the row's Save button.
      setErrors(formErrorsFrom(e, ['name'], 'Could not save that category.'))
    } finally { status.end() }
  }

  const setEnabled = async (c: Category, isEnabled: boolean) => {
    status.begin()
    try {
      await api.patch(`/categories/${c.id}`, { isEnabled })
      await onChanged()
      toast.show(
        isEnabled
          ? `Enabled '${c.name}'. It is back in the pickers.`
          : `Disabled '${c.name}'. It is hidden from the pickers, and transactions already filed under it keep it.`,
        { kind: 'success', key: TOAST_KEY },
      )
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not change that category.', { kind: 'error', key: TOAST_KEY })
    } finally { status.end() }
  }

  // The confirmation names what is actually at stake instead of asking "are you
  // sure?" about an unknown quantity. When something still uses the category the
  // server refuses anyway; checking first means the user finds out before the
  // click rather than after.
  const remove = async (c: Category) => {
    status.begin()
    try {
      const usage = await api.get<CategoryUsage>(`/categories/${c.id}/usage`)
      if (usage.total > 0) {
        toast.show(
          `'${c.name}' is still in use, so it cannot be deleted. Disable it instead — ` +
            `that hides it everywhere and keeps the history.`,
          { kind: 'error', key: TOAST_KEY },
        )
        return
      }
      if (!window.confirm(`Delete '${c.name}'? Nothing is using it, so this is safe.`)) return
      await api.del(`/categories/${c.id}`)
      await onChanged()
      toast.show(`Deleted category '${c.name}'.`, { kind: 'success', key: TOAST_KEY })
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not delete that category.', { kind: 'error', key: TOAST_KEY })
    } finally { status.end() }
  }

  return { editing, errors, change, start, cancel, save, setEnabled, remove }
}
