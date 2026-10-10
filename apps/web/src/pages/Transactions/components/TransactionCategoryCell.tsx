import { memo } from 'react'
import { CategoryOptions } from '@wickermoney/ui-kit'
import type { Category, Transaction } from '../../../models/index.js'

/** Props for {@link TransactionCategoryCell}. */
export interface TransactionCategoryCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** Assigns this row's category; an empty string clears it. Must keep its identity between renders. */
  readonly onAssign: (id: string, categoryId: string) => Promise<void>
  /** Returns the categories to offer in this row's picker. */
  readonly categoryOptionsFor: (currentId: string | null) => readonly Category[]
}

/**
 * A row's category picker, which saves on change. Memoized: with stable props
 * a row does not re-render when something else on the page changes.
 *
 * A transfer leg has no category to assign: it is money moving, and offering a
 * spending category here is how one ends up counted as spending again.
 */
export const TransactionCategoryCell = memo(function TransactionCategoryCell(
  { transaction: t, onAssign, categoryOptionsFor }: TransactionCategoryCellProps,
) {
  if (t.transfer_id !== null) return <span className="tag">transfer</span>
  return (
    <div className="cat-cell">
      <select className="cat-cell__select" value={t.category_id ?? ''}
              aria-label={`Category for ${t.merchant}`}
              onChange={(e) => void onAssign(t.id, e.target.value)}>
        <CategoryOptions
          categories={categoryOptionsFor(t.category_id)}
          placeholder={{ value: '', label: '—' }}
        />
      </select>
      {t.category_source === 'rule' ? <span className="tag">rule</span> : null}
    </div>
  )
})
