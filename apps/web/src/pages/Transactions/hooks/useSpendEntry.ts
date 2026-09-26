import { useState, type FormEvent } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { EntryFields } from '../state/EntryFields.js'
import type { SpendEntry } from '../state/SpendEntry.js'

/**
 * State and submit action for recording a spending or income transaction.
 *
 * @param fields - The fields shared with the transfer form.
 * @param status - Busy flag and error message shared with the page.
 * @param onRecorded - Called after the transaction is saved so the list can be re-read.
 * @returns The form's own fields and its submit handler.
 */
export function useSpendEntry(
  fields: EntryFields, status: ActionStatus, onRecorded: () => Promise<void>,
): SpendEntry {
  const [amount, setAmount] = useState('-')
  const [categoryId, setCategoryId] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    status.begin()
    try {
      await api.post('/transactions', {
        accountId: fields.accountId, merchant: fields.merchant, amount,
        transactionDate: fields.date,
        ...(categoryId === '' ? {} : { categoryId }),
      })
      fields.setMerchant(''); setAmount('-')
      await onRecorded()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not record the transaction.')
    } finally { status.end() }
  }

  return { amount, setAmount, categoryId, setCategoryId, submit }
}
