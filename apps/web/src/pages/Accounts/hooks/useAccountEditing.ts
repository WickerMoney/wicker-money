import { useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Account } from '../../../models/index.js'
import type { AccountEdit } from '../state/AccountEdit.js'
import type { AccountEditing } from '../state/AccountEditing.js'

/**
 * Owns the accounts table's inline editing.
 *
 * @param status - Busy flag and error message shared with the page.
 * @param onChanged - Called after a save so the list can be re-read.
 * @returns The row being edited and the actions on it.
 */
export function useAccountEditing(
  status: ActionStatus, onChanged: () => Promise<void>,
): AccountEditing {
  const [editing, setEditing] = useState<AccountEdit | null>(null)

  const start = (a: Account) => {
    setEditing({
      id: a.id, name: a.name, accountType: a.accountType,
      currencyCode: a.currencyCode, bufferAmount: a.bufferAmount,
    })
  }

  const cancel = () => setEditing(null)

  const save = async () => {
    if (editing === null) return
    status.begin()
    try {
      await api.patch(`/accounts/${editing.id}`, {
        name: editing.name.trim(),
        accountType: editing.accountType,
        currencyCode: editing.currencyCode,
        bufferAmount: editing.bufferAmount,
      })
      setEditing(null)
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not save that account.')
    } finally { status.end() }
  }

  return { editing, change: setEditing, start, cancel, save }
}
