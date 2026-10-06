import { Button, IconButton } from '@wickermoney/ui-kit'
import type { Transaction } from '../../../models/index.js'
import type { TransactionEditing } from '../state/TransactionEditing.js'

/** Props for {@link TransactionActionsCell}. */
export interface TransactionActionsCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** The table's editing state. */
  readonly row: TransactionEditing
  /** `true` while a request is in flight; disables the buttons. */
  readonly busy: boolean
}

/** A row's icon buttons: Edit and Delete, or Save and Cancel while the row is being edited. */
export function TransactionActionsCell({ transaction: t, row, busy }: TransactionActionsCellProps) {
  const { editing } = row
  if (editing?.id === t.id) {
    return (
      <div className="wm-row-actions">
        <Button
          variant="primary"
          disabled={busy || editing.merchant.trim() === '' || editing.amount.trim() === ''}
          onClick={() => void row.save()}
        >
          Save
        </Button>
        <Button disabled={busy} onClick={row.cancel}>Cancel</Button>
      </div>
    )
  }
  return (
    <div className="wm-row-actions">
      <IconButton icon="edit" label="Edit" disabled={busy} onClick={() => row.start(t)} />
      <IconButton icon="delete" label="Delete" variant="danger" disabled={busy} onClick={() => void row.remove(t)} />
    </div>
  )
}
