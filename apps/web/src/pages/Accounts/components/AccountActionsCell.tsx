import { Button, FormError, IconButton } from '@wickermoney/ui-kit'
import type { Account } from '../../../models/index.js'
import type { AccountEditing } from '../state/AccountEditing.js'

/** Props for {@link AccountActionsCell}. */
export interface AccountActionsCellProps {
  /** The row. */
  readonly account: Account
  /** The table's editing state. */
  readonly row: AccountEditing
  /** `true` while a request is in flight; disables the buttons. */
  readonly busy: boolean
  /** Called to open the opening-balance correction for the account. */
  readonly onFixOpeningBalance: (account: Account) => void
  /** Called to archive the account. */
  readonly onArchive: (account: Account) => void
  /** Called to start deleting the account. */
  readonly onDelete: (account: Account) => void
}

/** A row's icon buttons, or Save and Cancel while the row is being edited. */
export function AccountActionsCell({
  account: a, row, busy, onFixOpeningBalance, onArchive, onDelete,
}: AccountActionsCellProps) {
  if (row.editing?.id === a.id) {
    return (
      <>
        <div className="wm-row-actions">
          <Button variant="primary" disabled={busy} onClick={() => void row.save()}>Save</Button>
          <Button disabled={busy} onClick={row.cancel}>Cancel</Button>
        </div>
        <FormError message={row.errors.form} />
      </>
    )
  }
  return (
    <div className="wm-row-actions">
      <IconButton icon="edit" label="Edit" disabled={busy} onClick={() => row.start(a)} />
      <IconButton icon="balance" label="Fix opening balance" disabled={busy} onClick={() => onFixOpeningBalance(a)} />
      {a.archivedAt === null ? (
        <IconButton icon="archive" label="Archive" disabled={busy} onClick={() => onArchive(a)} />
      ) : <span className="wm-icon-slot" aria-hidden="true" />}
      <IconButton icon="delete" label="Delete" variant="danger" disabled={busy} onClick={() => onDelete(a)} />
    </div>
  )
}
