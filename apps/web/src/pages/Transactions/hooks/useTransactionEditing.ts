import { useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Transaction } from '../../../models/index.js'
import type { TransactionEdit } from '../state/TransactionEdit.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/**
 * Owns the transaction table's inline editing, category assignment and delete.
 *
 * @param status - Busy flag and error message shared with the page.
 * @param onChanged - Called after any change so the list can be re-read.
 * @returns The row being edited and the actions on rows.
 */
export function useTransactionEditing(
  status: ActionStatus, onChanged: () => Promise<void>,
): TransactionEditing {
  const [editing, setEditing] = useState<TransactionEdit | null>(null)

  const start = (t: Transaction) => {
    setEditing({
      id: t.id,
      merchant: t.merchant,
      amount: t.amount,
      transactionDate: t.transaction_date,
      notes: t.notes ?? '',
      isTransfer: t.transfer_id !== null,
    })
  }

  const cancel = () => setEditing(null)

  const assign = async (id: string, next: string) => {
    status.show(null)
    try {
      await api.post('/transactions/categorize', {
        transactionIds: [id],
        categoryId: next === '' ? null : next,
      })
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not set that category.')
    }
  }

  const save = async () => {
    if (editing === null) return
    status.begin()
    try {
      await api.patch(`/transactions/${editing.id}`, {
        merchant: editing.merchant.trim(),
        amount: editing.amount,
        transactionDate: editing.transactionDate,
        notes: editing.notes.trim() === '' ? null : editing.notes.trim(),
      })
      setEditing(null)
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not save that transaction.')
    } finally { status.end() }
  }

  // The confirmation says which is about to happen, because a transfer's other
  // leg disappearing along with the clicked one would otherwise read as data loss
  // rather than the deliberate delete the API performs.
  const remove = async (t: Transaction) => {
    const message = t.transfer_id !== null
      ? `Delete this transfer of ${formatMoney(t.amount)}? Both sides of the transfer will be removed.`
      : `Delete this transaction (${formatMoney(t.amount)} -- ${t.merchant})?`
    if (!window.confirm(message)) return
    status.begin()
    try {
      await api.del(`/transactions/${t.id}`)
      if (editing?.id === t.id) setEditing(null)
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not delete that transaction.')
    } finally { status.end() }
  }

  return { editing, change: setEditing, start, cancel, save, remove, assign }
}
