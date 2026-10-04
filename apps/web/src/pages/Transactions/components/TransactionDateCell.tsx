import { InlineInput } from '../../../forms/InlineInput.js'
import type { Transaction } from '../../../models/index.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/** Props for {@link TransactionDateCell}. */
export interface TransactionDateCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** The table's editing state. */
  readonly row: TransactionEditing
}

/** A row's date: plain text, or a date input while the row is being edited. */
export function TransactionDateCell({ transaction: t, row }: TransactionDateCellProps) {
  const { editing } = row
  if (editing?.id !== t.id) return <>{t.transaction_date}</>
  return (
    <InlineInput
      type="date" aria-label={`Date for ${t.merchant}`} error={row.errors.fields['transactionDate']}
      value={editing.transactionDate}
      onChange={(e) => row.change({ ...editing, transactionDate: e.target.value })}
      onKeyDown={(e) => { if (e.key === 'Escape') row.cancel() }}
    />
  )
}
