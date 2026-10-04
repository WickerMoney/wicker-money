import { useState } from 'react'
import { NO_FORM_ERRORS, formErrorsFrom, hasFormErrors, type FormErrors } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import { checkMoney, checkText, fieldErrors } from '../../../lib/fieldChecks.js'
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
  const [errors, setErrors] = useState<FormErrors>(NO_FORM_ERRORS)

  const start = (a: Account) => {
    setEditing({
      id: a.id, name: a.name, accountType: a.accountType,
      currencyCode: a.currencyCode, bufferAmount: a.bufferAmount,
    })
    setErrors(NO_FORM_ERRORS)
  }

  const cancel = () => { setEditing(null); setErrors(NO_FORM_ERRORS) }

  const change = (next: AccountEdit) => {
    // A field's message goes once that field changes; the others stay.
    setErrors((current) => ({
      form: current.form,
      fields: Object.fromEntries(Object.entries(current.fields).filter(
        ([field]) => editing === null || next[field as keyof AccountEdit] === editing[field as keyof AccountEdit],
      )),
    }))
    setEditing(next)
  }

  const save = async () => {
    if (editing === null) return
    const buffer = editing.bufferAmount.trim()
    const problems = fieldErrors({
      name: checkText(editing.name, 200),
      currencyCode: /^[A-Za-z]{3}$/.test(editing.currencyCode.trim()) ? undefined : 'Must be a 3-letter code, like USD.',
      // An emptied field means no buffer, not an invalid amount.
      bufferAmount: buffer === '' ? undefined : checkMoney(buffer, 'nonNegative'),
    })
    setErrors(problems)
    if (hasFormErrors(problems)) return
    status.begin()
    try {
      await api.patch(`/accounts/${editing.id}`, {
        name: editing.name.trim(),
        accountType: editing.accountType,
        currencyCode: editing.currencyCode,
        // An emptied field means no buffer, not an invalid amount.
        bufferAmount: editing.bufferAmount.trim() === '' ? '0' : editing.bufferAmount.trim(),
      })
      setEditing(null)
      await onChanged()
    } catch (e) {
      setErrors(formErrorsFrom(
        e, ['name', 'currencyCode', 'bufferAmount'], 'Could not save that account.',
      ))
    } finally { status.end() }
  }

  // A checkbox saves on its own, outside the row editor: it is one click with
  // nothing to type, and waiting for "Save" would make it look ignored.
  const setSpendable = async (a: Account, spendable: boolean) => {
    status.begin()
    try {
      await api.patch(`/accounts/${a.id}`, { spendable })
      await onChanged()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not save that account.')
    } finally { status.end() }
  }

  return { editing, errors, change, start, cancel, save, setSpendable }
}
