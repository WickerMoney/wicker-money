import { Button, Field, FormError, SelectField } from '@wickermoney/ui-kit'
import type { Account } from '../../../models/index.js'
import type { EntryFields } from '../state/EntryFields.js'
import type { TransferEntry } from '../state/TransferEntry.js'

/** Props for {@link TransferForm}. */
export interface TransferFormProps {
  /** Accounts money can move between. */
  readonly accounts: readonly Account[]
  /** The fields shared with the spend form. */
  readonly fields: EntryFields
  /** This form's own fields and submit handler. */
  readonly entry: TransferEntry
  /** `true` while a request is in flight; disables the submit button. */
  readonly busy: boolean
}

/** The form for moving money from one of the user's accounts to another. */
export function TransferForm({ accounts, fields, entry, busy }: TransferFormProps) {
  return (
    <form onSubmit={(e) => void entry.submit(e)} ref={entry.formRef} noValidate>
      <SelectField label="From account" value={fields.accountId} error={entry.errors.fields['fromAccountId']}
                   onChange={(e) => fields.setAccountId(e.target.value)}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </SelectField>
      <SelectField label="To account" value={entry.toAccountId} error={entry.errors.fields['toAccountId']}
                   onChange={(e) => entry.setToAccountId(e.target.value)}>
        <option value="">Choose an account</option>
        {accounts
          .filter((a) => a.id !== fields.accountId)
          .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </SelectField>
      <Field label="Amount" inputMode="decimal" required value={entry.amount} error={entry.errors.fields['amount']}
             placeholder="250.00"
             onChange={(e) => entry.setAmount(e.target.value)} />
      <p className="form-hint">
        A positive amount — which account it leaves is what sets the direction.
        Both sides are written together, and a transfer counts as neither
        income nor spending.
      </p>
      <Field label="Date" type="date" required value={fields.date} error={entry.errors.fields['transactionDate']}
             onChange={(e) => fields.setDate(e.target.value)} />
      <Field label="Description" value={fields.merchant} placeholder="Optional"
             error={entry.errors.fields['description']}
             onChange={(e) => fields.setMerchant(e.target.value)} />
      <Button
        type="submit"
        variant="primary"
        disabled={busy || entry.toAccountId === '' || entry.amount.trim() === ''}
      >
        {busy ? 'Moving…' : 'Move money'}
      </Button>
      <FormError message={entry.errors.form} />
    </form>
  )
}
