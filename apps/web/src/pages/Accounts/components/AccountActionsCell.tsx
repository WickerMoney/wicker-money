import { Button } from '@wickermoney/ui-kit'
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

/** A row's buttons, or Save and Cancel while the row is being edited. */
export function AccountActionsCell({
  account: a, row, busy, onFixOpeningBalance, onArchive, onDelete,
}: AccountActionsCellProps) {
  if (row.editing?.id === a.id) {
    return (
      <div className="page__actions page__actions--tight">
        <Button variant="primary" disabled={busy} onClick={() => void row.save()}>Save</Button>
        <Button disabled={busy} onClick={row.cancel}>Cancel</Button>
      </div>
    )
  }
  return (
    <div className="page__actions page__actions--tight">
      <Button disabled={busy} onClick={() => row.start(a)}>Edit</Button>
      <Button disabled={busy} onClick={() => onFixOpeningBalance(a)}>Fix opening balance</Button>
      {a.archivedAt === null ? (
        <Button disabled={busy} onClick={() => onArchive(a)}>Archive</Button>
      ) : null}
      <Button variant="danger" disabled={busy} onClick={() => onDelete(a)}>Delete</Button>
    </div>
  )
}
