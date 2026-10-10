import { memo } from 'react'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Transaction } from '../../../models/index.js'

/** Props for {@link TransactionAmountCell}. */
export interface TransactionAmountCellProps {
  /** The row. */
  readonly transaction: Transaction
}

/** A row's amount as coloured money. Editing it happens in the edit dialog. Memoized. */
export const TransactionAmountCell = memo(function TransactionAmountCell({ transaction: t }: TransactionAmountCellProps) {
  return (
    <span className={Number(t.amount) < 0 ? 'wm-neg' : 'wm-pos'}>
      {formatMoney(t.amount)}
    </span>
  )
})
