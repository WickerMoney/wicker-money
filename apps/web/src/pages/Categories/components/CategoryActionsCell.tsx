import { Button, FormError, IconButton } from '@wickermoney/ui-kit'
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

/**
 * A row's icon buttons: Edit, Disable/Enable and Delete, or Save and Cancel
 * while the row is being edited. Icons carry their name as an accessible label
 * and tooltip.
 */
export function CategoryActionsCell({ category: c, row, busy }: CategoryActionsCellProps) {
  if (row.editing?.id === c.id) {
    return (
      <>
        <div className="wm-row-actions">
          <Button variant="primary" busy={busy} onClick={() => void row.save()}>Save</Button>
          <Button busy={busy} onClick={row.cancel}>Cancel</Button>
        </div>
        <FormError message={row.errors.form} />
      </>
    )
  }
  return (
    <div className="wm-row-actions">
      <IconButton icon="edit" label="Edit" busy={busy} onClick={() => row.start(c)} />
      <IconButton
        icon={c.is_enabled ? 'disable' : 'enable'}
        label={c.is_enabled ? 'Disable' : 'Enable'}
        busy={busy}
        onClick={() => void row.setEnabled(c, !c.is_enabled)}
      />
      <IconButton icon="delete" label="Delete" variant="danger" busy={busy} onClick={() => void row.remove(c)} />
    </div>
  )
}
