import { useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, CategoryUsage } from '../../../models/index.js'
import type { CategoryEdit } from '../state/CategoryEdit.js'
import type { CategoryEditing } from '../state/CategoryEditing.js'

/**
 * Owns the category table's inline editing, enable/disable and delete.
 *
 * @param status - Busy flag and error message shared with the page.
 * @param onChanged - Called after any change so the list can be re-read.
 * @returns The row being edited and the actions on rows.
 */
export function useCategoryEditing(
  status: ActionStatus, onChanged: () => Promise<void>,
): CategoryEditing {
  const [editing, setEditing] = useState<CategoryEdit | null>(null)

  const start = (c: Category) => {
    setEditing({ id: c.id, name: c.name, parentId: c.parent_id ?? '', kind: c.kind })
  }

  const cancel = () => setEditing(null)

  const save = async () => {
    if (editing === null) return
    status.begin()
    try {
      await api.patch(`/categories/${editing.id}`, {
        name: editing.name.trim(),
        parentId: editing.parentId === '' ? null : editing.parentId,
        kind: editing.kind,
      })
      setEditing(null)
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not save that category.')
    } finally { status.end() }
  }

  const setEnabled = async (c: Category, isEnabled: boolean) => {
    status.begin()
    try {
      await api.patch(`/categories/${c.id}`, { isEnabled })
      await onChanged()
      status.show(
        isEnabled
          ? null
          : `'${c.name}' is hidden from the pickers. Transactions already filed under it keep it.`,
      )
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not change that category.')
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
        status.show(
          `'${c.name}' is still in use, so it cannot be deleted. Disable it instead — ` +
            `that hides it everywhere and keeps the history.`,
        )
        return
      }
      if (!window.confirm(`Delete '${c.name}'? Nothing is using it, so this is safe.`)) return
      await api.del(`/categories/${c.id}`)
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not delete that category.')
    } finally { status.end() }
  }

  return { editing, change: setEditing, start, cancel, save, setEnabled, remove }
}
