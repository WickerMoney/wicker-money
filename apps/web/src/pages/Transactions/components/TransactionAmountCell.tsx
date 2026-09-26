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

/** A row's amount: coloured money, or an input while the row is being edited. */
export function TransactionAmountCell({ transaction: t, row }: TransactionAmountCellProps) {
  const { editing } = row
  if (editing?.id !== t.id) {
    return (
      <span className={Number(t.amount) < 0 ? 'fio-neg' : 'fio-pos'}>
        {formatMoney(t.amount)}
      </span>
    )
  }
  return (
    <div className="txn-edit">
      <input
        className="cat-edit" inputMode="decimal"
        aria-label={`Amount for ${t.merchant}`}
        value={editing.amount}
        onChange={(e) => row.change({ ...editing, amount: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') row.cancel() }}
      />
      {editing.isTransfer ? <span className="fio-muted">Syncs the other leg</span> : null}
    </div>
  )
}
