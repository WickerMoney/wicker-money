import { guardBusy } from '@wickermoney/ui-kit'
import type { Account } from '../../../models/index.js'
import { SPENDABLE_TYPES } from '../helpers/accountTypes.js'
import type { AccountEditing } from '../state/AccountEditing.js'

/** Props for {@link AccountSpendableCell}. */
export interface AccountSpendableCellProps {
  /** The row. */
  readonly account: Account
  /** The table's editing state. */
  readonly row: AccountEditing
  /** Whether another change is in flight. */
  readonly busy: boolean
}

/**
 * Whether the account counts toward safe to spend: a checkbox for checking and
 * savings, saved as soon as it changes, and a dash for types that never can.
 * An archived account is never listed by "Until payday", so its box is shown
 * but disabled. While another change is in flight the box is `aria-disabled`, not `disabled`, so it keeps focus.
 */
export function AccountSpendableCell({ account: a, row, busy }: AccountSpendableCellProps) {
  if (!SPENDABLE_TYPES.includes(a.accountType)) {
    return <span className="acct-na" title="Only checking and savings accounts can count toward safe to spend.">—</span>
  }
  return (
    <input
      type="checkbox"
      aria-label={`Count ${a.name} toward safe to spend`}
      checked={a.spendable}
      disabled={a.archivedAt !== null}
      aria-disabled={busy ? true : undefined}
      onChange={guardBusy(busy, (e) => { void row.setSpendable(a, e.target.checked) })}
    />
  )
}
