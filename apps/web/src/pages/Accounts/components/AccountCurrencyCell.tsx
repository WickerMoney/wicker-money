import { InlineInput } from '../../../forms/InlineInput.js'
import type { Account } from '../../../models/index.js'
import type { AccountEditing } from '../state/AccountEditing.js'

/** Props for {@link AccountCurrencyCell}. */
export interface AccountCurrencyCellProps {
  /** The row. */
  readonly account: Account
  /** The table's editing state. */
  readonly row: AccountEditing
}

/** A row's currency code as text, or an input while the row is being edited. */
export function AccountCurrencyCell({ account: a, row }: AccountCurrencyCellProps) {
  const { editing } = row
  if (editing?.id !== a.id) return <>{a.currencyCode}</>
  return (
    <InlineInput
      style={{ width: '4.5em' }}
      error={row.errors.fields['currencyCode']}
      aria-label={`Currency of ${a.name}`}
      value={editing.currencyCode}
      maxLength={3}
      onChange={(e) => row.change({ ...editing, currencyCode: e.target.value.toUpperCase() })}
    />
  )
}
