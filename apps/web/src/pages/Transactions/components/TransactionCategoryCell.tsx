import { CategoryOptions } from '@wickermoney/ui-kit'
import type { Category, Transaction } from '../../../models/index.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/** Props for {@link TransactionCategoryCell}. */
export interface TransactionCategoryCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** The table's editing state. */
  readonly row: TransactionEditing
  /** Returns the categories to offer in this row's picker. */
  readonly categoryOptionsFor: (currentId: string | null) => readonly Category[]
}

/**
 * A row's category picker, which saves on change.
 *
 * A transfer leg has no category to assign: it is money moving, and offering a
 * spending category here is how one ends up counted as spending again.
 */
export function TransactionCategoryCell({ transaction: t, row, categoryOptionsFor }: TransactionCategoryCellProps) {
  if (t.transfer_id !== null) return <span className="tag">transfer</span>
  return (
    <div className="cat-cell">
      <select className="cat-cell__select" value={t.category_id ?? ''}
              aria-label={`Category for ${t.merchant}`}
              onChange={(e) => void row.assign(t.id, e.target.value)}>
        <CategoryOptions
          categories={categoryOptionsFor(t.category_id)}
          placeholder={{ value: '', label: '—' }}
        />
      </select>
      {t.category_source === 'rule' ? <span className="tag">rule</span> : null}
    </div>
  )
}
