import { FormError } from '@wickermoney/ui-kit'
import { InlineInput } from '../../../forms/InlineInput.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Transaction } from '../../../models/index.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/** Props for {@link TransactionAmountCell}. */
export interface TransactionAmountCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** The table's editing state. */
  readonly row: TransactionEditing
}

/**
 * A row's amount: coloured money, or an input while the row is being edited.
 *
 * While editing, a refusal that is not about one field (a transfer leg
 * keeping its direction, say) is shown here, in the cell beside the row's
 * Save button.
 */
export function TransactionAmountCell({ transaction: t, row }: TransactionAmountCellProps) {
  const { editing } = row
  if (editing?.id !== t.id) {
    return (
      <span className={Number(t.amount) < 0 ? 'wm-neg' : 'wm-pos'}>
        {formatMoney(t.amount)}
      </span>
    )
  }
  return (
    <div className="txn-edit">
      <InlineInput
        inputMode="decimal"
        aria-label={`Amount for ${t.merchant}`}
        error={row.errors.fields['amount']}
        value={editing.amount}
        onChange={(e) => row.change({ ...editing, amount: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') row.cancel() }}
      />
      {editing.isTransfer ? <span className="wm-muted">Syncs the other leg</span> : null}
      <FormError message={row.errors.form} />
    </div>
  )
}
