import { useState, type FormEvent } from 'react'
import {
  Button, Field, FormError, SelectField, formErrorsFrom, hasFormErrors, useFormErrors,
} from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { checkMoney, checkText, fieldErrors } from '../../../lib/fieldChecks.js'
import { ACCOUNT_TYPES, SPENDABLE_TYPES } from '../helpers/accountTypes.js'

/** Props for {@link AddAccountForm}. */
export interface AddAccountFormProps {
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after an account is created so the list can be re-read. */
  readonly onCreated: () => Promise<void>
}

/** A form that creates one account with an opening balance. It sits inside a dialog, which supplies the title. */
export function AddAccountForm({ status, onCreated }: AddAccountFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('checking')
  const [opening, setOpening] = useState('0')
  // Follows the type's default (checking on, savings off) until changed by hand.
  const [spendable, setSpendable] = useState(true)
  const canSpend = SPENDABLE_TYPES.includes(type)
  const form = useFormErrors()

  const changeType = (next: string) => {
    setType(next)
    setSpendable(next === 'checking')
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const problems = fieldErrors({ name: checkText(name, 200), initialBalance: checkMoney(opening) })
    form.show(problems)
    if (hasFormErrors(problems)) return
    status.begin()
    try {
      await api.post('/accounts', {
        name, accountType: type, initialBalance: opening.trim(), spendable: canSpend && spendable,
      })
      setName(''); setOpening('0'); changeType('checking')
      await onCreated()
    } catch (e) {
      form.show(formErrorsFrom(e, ['name', 'accountType', 'initialBalance'], 'Could not create the account.'))
    } finally { status.end() }
  }

  return (
    <form onSubmit={create} ref={form.ref} noValidate>
        <Field label="Name" required value={name} error={form.errors.fields['name']}
               onChange={(e) => { setName(e.target.value); form.clearField('name') }} />
        <SelectField label="Type" value={type} error={form.errors.fields['accountType']}
                     onChange={(e) => changeType(e.target.value)}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </SelectField>
        <Field label="Opening balance" inputMode="decimal" error={form.errors.fields['initialBalance']}
               value={opening} onChange={(e) => { setOpening(e.target.value); form.clearField('initialBalance') }} />
        {canSpend ? (
          <>
            <label className="check">
              <input type="checkbox" checked={spendable} onChange={(e) => setSpendable(e.target.checked)} />
              <span>Count toward safe to spend</span>
            </label>
            <p className="form-hint">
              Leave this off for money you are not spending day to day, like savings or a yearly-bills account.
            </p>
          </>
        ) : null}
        <Button type="submit" variant="primary" disabled={status.busy || name.trim() === ''}>
          {status.busy ? 'Adding…' : 'Add account'}
        </Button>
        <FormError message={form.errors.form} />
    </form>
  )
}
