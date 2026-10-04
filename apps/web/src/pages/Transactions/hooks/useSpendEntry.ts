import { useState, type FormEvent } from 'react'
import { formErrorsFrom, hasFormErrors, useFormErrors } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { checkMoney, checkText, fieldErrors, REQUIRED_MESSAGE } from '../../../lib/fieldChecks.js'
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
  const form = useFormErrors()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // Zero is allowed, as the API allows it: a $0 receipt is still a record.
    const problems = fieldErrors({
      merchant: checkText(fields.merchant, 300),
      amount: checkMoney(amount),
      transactionDate: fields.date === '' ? REQUIRED_MESSAGE : undefined,
    })
    form.show(problems)
    if (hasFormErrors(problems)) return
    status.begin()
    try {
      await api.post('/transactions', {
        accountId: fields.accountId, merchant: fields.merchant, amount: amount.trim(),
        transactionDate: fields.date,
        ...(categoryId === '' ? {} : { categoryId }),
      })
      fields.setMerchant(''); setAmount('-')
      await onRecorded()
    } catch (e) {
      form.show(formErrorsFrom(
        e, ['accountId', 'merchant', 'amount', 'transactionDate', 'categoryId'], 'Could not record the transaction.',
      ))
    } finally { status.end() }
  }

  return {
    amount,
    setAmount: (next: string) => { setAmount(next); form.clearField('amount') },
    categoryId, setCategoryId, errors: form.errors, formRef: form.ref, submit,
  }
}
