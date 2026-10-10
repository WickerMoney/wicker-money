import { memo } from 'react'
import { IconButton } from '@wickermoney/ui-kit'
import type { Transaction } from '../../../models/index.js'

/** Props for {@link TransactionActionsCell}. */
export interface TransactionActionsCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** Opens the row in the edit dialog. Must keep its identity between renders. */
  readonly onEdit: (transaction: Transaction) => void
  /** Deletes the row after confirming. Must keep its identity between renders. */
  readonly onDelete: (transaction: Transaction) => Promise<void>
  /** `true` while a request is in flight; disables the buttons. */
  readonly busy: boolean
}

/** A row's icon buttons: Edit, which opens the edit dialog, and Delete. Memoized. */
export const TransactionActionsCell = memo(function TransactionActionsCell(
  { transaction: t, onEdit, onDelete, busy }: TransactionActionsCellProps,
) {
  return (
    <div className="wm-row-actions">
      <IconButton icon="edit" label="Edit" disabled={busy} onClick={() => onEdit(t)} />
      <IconButton icon="delete" label="Delete" variant="danger" disabled={busy} onClick={() => void onDelete(t)} />
    </div>
  )
})
