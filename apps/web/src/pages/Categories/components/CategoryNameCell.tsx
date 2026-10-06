import { ChevronToggle } from '../../../disclosure/index.js'
import { InlineInput } from '../../../forms/InlineInput.js'
import type { Category } from '../../../models/index.js'
import type { CategoryEditing } from '../state/CategoryEditing.js'

/** Props for {@link CategoryNameCell}. */
export interface CategoryNameCellProps {
  /** The row. */
  readonly category: Category
  /** The table's editing state. */
  readonly row: CategoryEditing
  /** Whether this parent's children are showing, and how to change that. Omit for a child row. */
  readonly group?: {
    /** Children currently listed under this parent. */
    readonly count: number
    readonly expanded: boolean
    readonly onToggle: () => void
  }
}

/**
 * A row's name: the label with its disabled tag, or a rename input while the
 * row is being edited. A parent with children also carries the arrow that
 * opens and closes them.
 */
export function CategoryNameCell({ category: c, row, group }: CategoryNameCellProps) {
  const { editing } = row
  if (editing?.id === c.id) {
    return (
      <InlineInput
        aria-label={`Rename ${c.name}`}
        error={row.errors.fields['name']}
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
  const hasChildren = group !== undefined && group.count > 0
  const label = c.parent_id === null
    ? (
      <span className="cat-parent">
        {hasChildren ? (
          <ChevronToggle
            expanded={group.expanded}
            onToggle={group.onToggle}
            label={`${group.expanded ? 'Hide' : 'Show'} ${group.count} ${group.count === 1 ? 'subcategory' : 'subcategories'} of ${c.name}`}
          />
        ) : <span className="disclosure disclosure--spacer" aria-hidden="true" />}
        <strong>{c.name}</strong>
        {hasChildren ? <span className="acc__count">{group.count}</span> : null}
      </span>
    )
    : <span className="cat-child">{c.name}</span>
  return (
    <span className={c.is_enabled ? undefined : 'cat-off'}>
      {label}
      {!c.is_enabled ? <span className="tag">disabled</span> : null}
    </span>
  )
}
