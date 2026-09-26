import type { Category } from '../../../models/index.js'
import type { CategoryEditing } from '../state/CategoryEditing.js'

/** Props for {@link CategoryNameCell}. */
export interface CategoryNameCellProps {
  /** The row. */
  readonly category: Category
  /** The table's editing state. */
  readonly row: CategoryEditing
}

/** A row's name: the label with its disabled tag, or a rename input while the row is being edited. */
export function CategoryNameCell({ category: c, row }: CategoryNameCellProps) {
  const { editing } = row
  if (editing?.id === c.id) {
    return (
      <input
        className="cat-edit"
        aria-label={`Rename ${c.name}`}
        value={editing.name}
        autoFocus
        onChange={(e) => row.change({ ...editing, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void row.save()
          if (e.key === 'Escape') row.cancel()
        }}
      />
    )
  }
  const label = c.parent_id === null
    ? <strong>{c.name}</strong>
    : <span className="cat-child">{c.name}</span>
  return (
    <span className={c.is_enabled ? undefined : 'cat-off'}>
      {label}
      {!c.is_enabled ? <span className="tag">disabled</span> : null}
    </span>
  )
}
