import { Button, CategoryOptions, Field, FormError, SelectField } from '@wickermoney/ui-kit'
import type { AccountOption, Category } from '../../../models/index.js'
import type { EntryFields } from '../state/EntryFields.js'
import type { SpendEntry } from '../state/SpendEntry.js'

/** Props for {@link SpendForm}. */
export interface SpendFormProps {
  /** Accounts the transaction can be recorded against. */
  readonly accounts: readonly AccountOption[]
  /** Categories offered for the new transaction. */
  readonly enabledCategories: readonly Category[]
  /** The fields shared with the transfer form. */
  readonly fields: EntryFields
  /** This form's own fields and submit handler. */
  readonly entry: SpendEntry
  /** `true` while a request is in flight; disables the submit button. */
  readonly busy: boolean
}

/** The form for one spending or income transaction. */
export function SpendForm({ accounts, enabledCategories, fields, entry, busy }: SpendFormProps) {
  return (
    <form onSubmit={(e) => void entry.submit(e)} ref={entry.formRef} noValidate>
      <SelectField label="Account" value={fields.accountId} error={entry.errors.fields['accountId']}
                   onChange={(e) => fields.setAccountId(e.target.value)}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </SelectField>
      <Field label="Merchant" required value={fields.merchant} error={entry.errors.fields['merchant']}
             onChange={(e) => fields.setMerchant(e.target.value)} />
      <Field label="Amount" inputMode="decimal" required value={entry.amount} error={entry.errors.fields['amount']}
             onChange={(e) => entry.setAmount(e.target.value)} />
      <p className="form-hint">
        Spending is negative, income positive. Moving money between your own
        accounts is a <strong>Transfer</strong>, not spending.
      </p>
      <Field label="Date" type="date" required value={fields.date} error={entry.errors.fields['transactionDate']}
             onChange={(e) => fields.setDate(e.target.value)} />
      <SelectField label="Category" value={entry.categoryId} error={entry.errors.fields['categoryId']}
                   onChange={(e) => entry.setCategoryId(e.target.value)}>
        <CategoryOptions
          categories={enabledCategories}
          placeholder={{ value: '', label: 'Auto (apply rules)' }}
        />
      </SelectField>
      <Button type="submit" variant="primary" disabled={busy || fields.merchant.trim() === ''}>
        {busy ? 'Saving…' : 'Record'}
      </Button>
      <FormError message={entry.errors.form} />
    </form>
  )
}
