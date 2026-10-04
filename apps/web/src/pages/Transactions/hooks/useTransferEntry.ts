import { useState, type FormEvent } from 'react'
import { formErrorsFrom, hasFormErrors, useFormErrors } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { checkMoney, fieldErrors, REQUIRED_MESSAGE } from '../../../lib/fieldChecks.js'
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
  const form = useFormErrors()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problems = fieldErrors({
      toAccountId: toAccountId === '' ? 'Choose the account the money goes to.' : undefined,
      // The API refuses zero ("a transfer of nothing") and a negative amount:
      // which account it leaves is what sets the direction.
      amount: checkMoney(amount, 'positive'),
      transactionDate: fields.date === '' ? REQUIRED_MESSAGE : undefined,
      description: fields.merchant.trim().length > 300 ? 'Must be 300 characters or fewer.' : undefined,
    })
    form.show(problems)
    if (hasFormErrors(problems)) return
    status.begin()
    try {
      await api.post('/transactions/transfer', {
        fromAccountId: fields.accountId,
        toAccountId,
        amount: amount.trim(),
        transactionDate: fields.date,
        ...(fields.merchant.trim() === '' ? {} : { description: fields.merchant.trim() }),
      })
      setAmount(''); fields.setMerchant('')
      await onRecorded()
    } catch (e) {
      form.show(formErrorsFrom(
        e, ['fromAccountId', 'toAccountId', 'amount', 'transactionDate', 'description'], 'Could not record the transfer.',
      ))
    } finally { status.end() }
  }

  return {
    toAccountId,
    setToAccountId: (id: string) => { setToAccountId(id); form.clearField('toAccountId') },
    amount,
    setAmount: (next: string) => { setAmount(next); form.clearField('amount') },
    errors: form.errors, formRef: form.ref, submit,
  }
}
