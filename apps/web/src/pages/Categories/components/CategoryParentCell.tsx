import type { Category } from '../../../models/index.js'
import { categoryName } from '../helpers/categoryName.js'
import type { CategoryEditing } from '../state/CategoryEditing.js'

/** Props for {@link CategoryParentCell}. */
export interface CategoryParentCellProps {
  /** The row. */
  readonly category: Category
  /** The table's editing state. */
  readonly row: CategoryEditing
  /** Every category, used to look up the parent's name. */
  readonly categories: readonly Category[] | null
  /** Top-level categories, the only legal parents. */
  readonly parents: readonly Category[]
}

/** A row's parent: its name, or a picker while the row is being edited. */
export function CategoryParentCell({ category: c, row, categories, parents }: CategoryParentCellProps) {
  const { editing } = row
  if (editing?.id === c.id) {
    return (
      <select
        className="cat-cell__select"
        aria-label={`Parent of ${c.name}`}
        value={editing.parentId}
        onChange={(e) => row.change({ ...editing, parentId: e.target.value })}
      >
        <option value="">Top level</option>
        {parents
          .filter((p) => p.id !== c.id)
          .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    )
  }
  return (
    <span className="wm-muted">
      {c.parent_id === null ? '—' : categoryName(categories, c.parent_id)}
    </span>
  )
}
