import { InlineInput } from '../../../forms/InlineInput.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Account } from '../../../models/index.js'
import { SPENDABLE_TYPES } from '../helpers/accountTypes.js'
import type { AccountEditing } from '../state/AccountEditing.js'

/** Props for {@link AccountBufferCell}. */
export interface AccountBufferCellProps {
  /** The row. */
  readonly account: Account
  /** The table's editing state. */
  readonly row: AccountEditing
}

/** What the buffer is for, shown on hover and read by screen readers. */
const BUFFER_HINT = 'The lowest balance you want to keep. "Until payday" warns before a bill takes the account below it.'

/**
 * A row's buffer: the minimum balance to keep, which "Until payday" measures
 * room against. Only checking and savings accounts appear there, so other
 * types show a dash, and the input appears only while the row's (possibly
 * just changed) type is one of those.
 */
export function AccountBufferCell({ account: a, row }: AccountBufferCellProps) {
  const { editing } = row
  if (editing?.id !== a.id) {
    return SPENDABLE_TYPES.includes(a.accountType)
      ? <span title={BUFFER_HINT}>{formatMoney(a.bufferAmount, a.currencyCode)}</span>
      : <span className="acct-na">—</span>
  }
  if (!SPENDABLE_TYPES.includes(editing.accountType)) return <span className="acct-na">—</span>
  return (
    <InlineInput
      style={{ width: '7em' }}
      error={row.errors.fields['bufferAmount']}
      inputMode="decimal"
      aria-label={`Buffer for ${a.name}`}
      title={BUFFER_HINT}
      value={editing.bufferAmount}
      onChange={(e) => row.change({ ...editing, bufferAmount: e.target.value })}
    />
  )
}
