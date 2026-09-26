import { useState, type FormEvent } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { EntryFields } from '../state/EntryFields.js'
import type { TransferEntry } from '../state/TransferEntry.js'

/**
 * State and submit action for moving money between two of the user's accounts.
 *
 * @param fields - The fields shared with the spend form.
 * @param status - Busy flag and error message shared with the page.
 * @param onRecorded - Called after the transfer is saved so the list can be re-read.
 * @returns The form's own fields and its submit handler.
 */
export function useTransferEntry(
  fields: EntryFields, status: ActionStatus, onRecorded: () => Promise<void>,
): TransferEntry {
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    status.begin()
    try {
      await api.post('/transactions/transfer', {
        fromAccountId: fields.accountId,
        toAccountId,
        amount,
        transactionDate: fields.date,
        ...(fields.merchant.trim() === '' ? {} : { description: fields.merchant.trim() }),
      })
      setAmount(''); fields.setMerchant('')
      await onRecorded()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not record the transfer.')
    } finally { status.end() }
  }

  return { toAccountId, setToAccountId, amount, setAmount, submit }
}
