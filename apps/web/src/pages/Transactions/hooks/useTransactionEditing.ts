import { useCallback, useState } from 'react'
import { NO_FORM_ERRORS, formErrorsFrom, hasFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { checkMoney, checkText, fieldErrors, REQUIRED_MESSAGE } from '../../../lib/fieldChecks.js'
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
  const [errors, setErrors] = useState<FormErrors>(NO_FORM_ERRORS)

  // `start`, `assign` and `remove` are what every row's cells call, so they
  // keep their identity while the editor's fields change on each keystroke;
  // otherwise typing in the dialog would re-render every row behind it.
  const { begin, end, show } = status

  const change = (next: TransactionEdit) => {
    // A field's message goes once that field changes; the others stay.
    setErrors((current) => ({
      form: current.form,
      fields: Object.fromEntries(Object.entries(current.fields).filter(
        ([field]) => editing === null || next[field as keyof TransactionEdit] === editing[field as keyof TransactionEdit],
      )),
    }))
    setEditing(next)
  }

  const start = useCallback((t: Transaction) => {
    setErrors(NO_FORM_ERRORS)
    setEditing({
      id: t.id,
      merchant: t.merchant,
      amount: t.amount,
      transactionDate: t.transaction_date,
      notes: t.notes ?? '',
      isTransfer: t.transfer_id !== null,
    })
  }, [])

  const cancel = () => { setEditing(null); setErrors(NO_FORM_ERRORS) }

  const assign = useCallback(async (id: string, next: string) => {
    show(null)
    try {
      await api.post('/transactions/categorize', {
        transactionIds: [id],
        categoryId: next === '' ? null : next,
      })
      await onChanged()
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not set that category.')
    }
  }, [show, onChanged])

  const save = async () => {
    if (editing === null) return
    const problems = fieldErrors({
      merchant: checkText(editing.merchant, 300),
      notes: editing.notes.trim().length > 1000 ? 'Must be 1000 characters or fewer.' : undefined,
      // A transfer leg also refuses zero; the server says so beside Save.
      amount: checkMoney(editing.amount),
      transactionDate: editing.transactionDate === '' ? REQUIRED_MESSAGE : undefined,
    })
    setErrors(problems)
    if (hasFormErrors(problems)) return
    status.begin()
    try {
      await api.patch(`/transactions/${editing.id}`, {
        merchant: editing.merchant.trim(),
        amount: editing.amount.trim(),
        transactionDate: editing.transactionDate,
        notes: editing.notes.trim() === '' ? null : editing.notes.trim(),
      })
      setEditing(null)
      await onChanged()
    } catch (e) {
      setErrors(formErrorsFrom(
        e, ['merchant', 'notes', 'amount', 'transactionDate'], 'Could not save that transaction.',
      ))
    } finally { status.end() }
  }

  // The confirmation says which is about to happen, because a transfer's other
  // leg disappearing along with the clicked one would otherwise read as data loss
  // rather than the deliberate delete the API performs.
  const remove = useCallback(async (t: Transaction) => {
    const message = t.transfer_id !== null
      ? `Delete this transfer of ${formatMoney(t.amount)}? Both sides of the transfer will be removed.`
      : `Delete this transaction (${formatMoney(t.amount)} -- ${t.merchant})?`
    if (!window.confirm(message)) return
    begin()
    try {
      await api.del(`/transactions/${t.id}`)
      setEditing((current) => (current?.id === t.id ? null : current))
      await onChanged()
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not delete that transaction.')
    } finally { end() }
  }, [begin, end, show, onChanged])

  return { editing, errors, change, start, cancel, save, remove, assign }
}
