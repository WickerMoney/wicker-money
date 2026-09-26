import type { Category } from '../../../models/index.js'
import type { CategoryEditing } from '../state/CategoryEditing.js'

/** Props for {@link CategoryKindCell}. */
export interface CategoryKindCellProps {
  /** The row. */
  readonly category: Category
  /** The table's editing state. */
  readonly row: CategoryEditing
}

/** A row's "counts as" kind: a label, or a picker while the row is being edited. */
export function CategoryKindCell({ category: c, row }: CategoryKindCellProps) {
  const { editing } = row
  if (editing?.id === c.id) {
    return (
      <select
        className="cat-cell__select"
        aria-label={`What ${c.name} counts as`}
        value={editing.kind}
        onChange={(e) => row.change({ ...editing, kind: e.target.value as Category['kind'] })}
      >
        <option value="expense">Spending</option>
        <option value="income">Income</option>
        <option value="transfer">Transfer</option>
      </select>
    )
  }
  if (c.kind === 'expense') return <span className="fio-muted">Spending</span>
  return <span className="tag">{c.kind === 'income' ? 'income' : 'transfer'}</span>
}
