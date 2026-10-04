import { Button, FormError } from '@wickermoney/ui-kit'
import type { Category } from '../../../models/index.js'
import type { CategoryEditing } from '../state/CategoryEditing.js'

/** Props for {@link CategoryActionsCell}. */
export interface CategoryActionsCellProps {
  /** The row. */
  readonly category: Category
  /** The table's editing state. */
  readonly row: CategoryEditing
  /** `true` while a request is in flight; disables the buttons. */
  readonly busy: boolean
}

/** A row's buttons: Edit, Disable/Enable and Delete, or Save and Cancel while the row is being edited. */
export function CategoryActionsCell({ category: c, row, busy }: CategoryActionsCellProps) {
  if (row.editing?.id === c.id) {
    return (
      <>
        <div className="page__actions page__actions--tight">
          <Button variant="primary" disabled={busy} onClick={() => void row.save()}>Save</Button>
          <Button disabled={busy} onClick={row.cancel}>Cancel</Button>
        </div>
        <FormError message={row.errors.form} />
      </>
    )
  }
  return (
    <div className="page__actions page__actions--tight">
      <Button disabled={busy} onClick={() => row.start(c)}>Edit</Button>
      <Button disabled={busy} onClick={() => void row.setEnabled(c, !c.is_enabled)}>
        {c.is_enabled ? 'Disable' : 'Enable'}
      </Button>
      <Button disabled={busy} onClick={() => void row.remove(c)}>Delete</Button>
    </div>
  )
}
