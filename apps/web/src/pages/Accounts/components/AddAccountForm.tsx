import { useState, type FormEvent } from 'react'
import { Button, Field, SelectField, Surface } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { ACCOUNT_TYPES, SPENDABLE_TYPES } from '../helpers/accountTypes.js'

/** Props for {@link AddAccountForm}. */
export interface AddAccountFormProps {
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after an account is created so the list can be re-read. */
  readonly onCreated: () => Promise<void>
}

/** A form that creates one account with an opening balance. */
export function AddAccountForm({ status, onCreated }: AddAccountFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<string>('checking')
  const [opening, setOpening] = useState('0')
  // Follows the type's default (checking on, savings off) until changed by hand.
  const [spendable, setSpendable] = useState(true)
  const canSpend = SPENDABLE_TYPES.includes(type)

  const changeType = (next: string) => {
    setType(next)
    setSpendable(next === 'checking')
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    status.begin()
    try {
      await api.post('/accounts', { name, accountType: type, initialBalance: opening, spendable: canSpend && spendable })
      setName(''); setOpening('0'); changeType('checking')
      await onCreated()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not create the account.')
    } finally { status.end() }
  }

  return (
    <Surface title="Add an account">
      <form onSubmit={create}>
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Type" value={type} onChange={(e) => changeType(e.target.value)}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </SelectField>
        <Field label="Opening balance" inputMode="decimal"
               value={opening} onChange={(e) => setOpening(e.target.value)} />
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
      </form>
    </Surface>
  )
}
