import { InlineInput } from '../../../forms/InlineInput.js'
import type { Transaction } from '../../../models/index.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/** Props for {@link TransactionMerchantCell}. */
export interface TransactionMerchantCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** The table's editing state. */
  readonly row: TransactionEditing
}

/** A row's merchant: plain text, or merchant and notes inputs while the row is being edited. */
export function TransactionMerchantCell({ transaction: t, row }: TransactionMerchantCellProps) {
  const { editing } = row
  if (editing?.id !== t.id) return <>{t.merchant}</>
  return (
    <div className="txn-edit">
      <InlineInput
        aria-label={`Merchant for ${t.merchant}`} error={row.errors.fields['merchant']}
        value={editing.merchant} autoFocus
        onChange={(e) => row.change({ ...editing, merchant: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') row.cancel() }}
      />
      <InlineInput
        aria-label={`Notes for ${t.merchant}`} error={row.errors.fields['notes']}
        value={editing.notes} placeholder="Notes (optional)"
        onChange={(e) => row.change({ ...editing, notes: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Escape') row.cancel() }}
      />
    </div>
  )
}
