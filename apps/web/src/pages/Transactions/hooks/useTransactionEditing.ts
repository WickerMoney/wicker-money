import { useCallback, useState } from 'react'
import { NO_FORM_ERRORS, formErrorsFrom, hasFormErrors, useToast, type FormErrors } from '@wickermoney/ui-kit'
import { ApiError } from '../../../api/ApiError.js'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { checkMoney, checkText, fieldErrors, REQUIRED_MESSAGE } from '../../../lib/fieldChecks.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Transaction } from '../../../models/index.js'
import type { TransactionEdit } from '../state/TransactionEdit.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/** What `DELETE /transactions/:id?undo=1` answers: the saved copy, or `null` when none was kept. */
interface DeleteResult { readonly undo: { readonly id: string; readonly expiresAt: string; readonly kind: string } | null }

/** What to tell the person when a restore was refused: the server's own words, except for a late one. */
function undoFailure(e: unknown): string {
  if (e instanceof ApiError && e.status === 410) return 'It is too late to undo that.'
  return e instanceof Error ? e.message : 'Could not undo that.'
}

/**
 * Owns the transaction table's inline editing, category assignment, delete and Undo of a delete.
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
  const { begin, end } = status
  const toast = useToast().show

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

  const assign = useCallback(async (t: Transaction, next: string, categoryName: string) => {
    try {
      await api.post('/transactions/categorize', {
        transactionIds: [t.id],
        categoryId: next === '' ? null : next,
      })
      toast(
        next === '' ? `Cleared the category of '${t.merchant}'.` : `Set '${t.merchant}' to ${categoryName}.`,
        { kind: 'success', key: 'transactions:categorize' },
      )
      await onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not set that category.', { kind: 'error', key: 'transactions:categorize' })
    }
  }, [toast, onChanged])

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
      // The dialog is closed by now, so the outcome is a toast (ADR 0009, section 3).
      toast(`Updated '${editing.merchant.trim()}'.`, { kind: 'success', key: 'transactions:edit' })
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
      // `?undo=1` asks the server to keep a copy for a few minutes (ADR 0016). It answers 200 with
      // `{ undo: null }` when Undo is off or the row could not be kept, and 204 from an older server.
      const result = await api.del<DeleteResult | undefined>(`/transactions/${t.id}?undo=1`)
      const undo = result?.undo ?? null
      setEditing((current) => (current?.id === t.id ? null : current))
      const isTransfer = t.transfer_id !== null
      // Says what went. A transfer's amount is shown without the sign of the leg that was clicked.
      const said = isTransfer
        ? `Deleted transfer of ${formatMoney(t.amount.replace(/^[-+]/, ''))}. Both sides were removed.`
        : `Deleted '${t.merchant}' (${formatMoney(t.amount)}).`
      // One key per snapshot: a second delete is a different toast with its own Undo, and an Undo
      // never restores the other delete's row (a shared key would replace the first toast's Undo).
      const key = undo === null ? 'transactions:delete' : `transactions:delete:${undo.id}`
      toast(said, {
        kind: 'success',
        key,
        ...(undo === null ? {} : {
          undo: {
            run: async () => {
              try {
                await api.post<unknown>(`/transaction-undos/${undo.id}/restore`)
              } catch (e) {
                // The error takes the place of the Undo toast: a refused restore will not work a second time.
                toast(undoFailure(e), { kind: 'error', key })
                return
              }
              toast(
                isTransfer
                  ? `Restored transfer of ${formatMoney(t.amount.replace(/^[-+]/, ''))}. Both sides were put back.`
                  : `Restored '${t.merchant}' (${formatMoney(t.amount)}).`,
                { kind: 'success', key: 'transactions:restore' },
              )
              await onChanged()
            },
          },
        }),
      })
      await onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete that transaction.', { kind: 'error', key: 'transactions:delete' })
    } finally { end() }
  }, [begin, end, toast, onChanged])

  return { editing, errors, change, start, cancel, save, remove, assign }
}
