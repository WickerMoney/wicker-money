import { useState, type FormEvent } from 'react'
import { Button, Field, SelectField, Surface } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { ACCOUNT_TYPES } from '../helpers/accountTypes.js'

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

  const create = async (event: FormEvent) => {
    event.preventDefault()
    status.begin()
    try {
      await api.post('/accounts', { name, accountType: type, initialBalance: opening })
      setName(''); setOpening('0')
      await onCreated()
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not create the account.')
    } finally { status.end() }
  }

  return (
    <Surface title="Add an account">
      <form onSubmit={create}>
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </SelectField>
        <Field label="Opening balance" inputMode="decimal"
               value={opening} onChange={(e) => setOpening(e.target.value)} />
        <Button type="submit" variant="primary" disabled={status.busy || name.trim() === ''}>
          {status.busy ? 'Adding…' : 'Add account'}
        </Button>
      </form>
    </Surface>
  )
}
