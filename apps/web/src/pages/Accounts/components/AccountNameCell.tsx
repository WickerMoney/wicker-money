import { InlineInput } from '../../../forms/InlineInput.js'
import type { Account } from '../../../models/index.js'
import type { AccountEditing } from '../state/AccountEditing.js'

/** Props for {@link AccountNameCell}. */
export interface AccountNameCellProps {
  /** The row. */
  readonly account: Account
  /** The table's editing state. */
  readonly row: AccountEditing
}

/** A row's name with an archived tag, or a rename input while the row is being edited. */
export function AccountNameCell({ account: a, row }: AccountNameCellProps) {
  const { editing } = row
  if (editing?.id === a.id) {
    return (
      <InlineInput
        aria-label={`Rename ${a.name}`}
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
  return (
    <span className={a.archivedAt !== null ? 'cat-off' : undefined}>
      {a.name}
      {a.archivedAt !== null ? <span className="tag">archived</span> : null}
    </span>
  )
}
