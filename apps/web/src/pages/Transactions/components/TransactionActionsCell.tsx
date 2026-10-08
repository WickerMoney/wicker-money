import { IconButton } from '@wickermoney/ui-kit'
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

/** A row's icon buttons: Edit, which opens the edit dialog, and Delete. */
export function TransactionActionsCell({ transaction: t, row, busy }: TransactionActionsCellProps) {
  return (
    <div className="wm-row-actions">
      <IconButton icon="edit" label="Edit" disabled={busy} onClick={() => row.start(t)} />
      <IconButton icon="delete" label="Delete" variant="danger" disabled={busy} onClick={() => void row.remove(t)} />
    </div>
  )
}
