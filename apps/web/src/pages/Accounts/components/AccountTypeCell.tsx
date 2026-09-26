import type { Account } from '../../../models/index.js'
import { ACCOUNT_TYPES } from '../helpers/accountTypes.js'
import type { AccountEditing } from '../state/AccountEditing.js'

/** Props for {@link AccountTypeCell}. */
export interface AccountTypeCellProps {
  /** The row. */
  readonly account: Account
  /** The table's editing state. */
  readonly row: AccountEditing
}

/** A row's account type as text, or a picker while the row is being edited. */
export function AccountTypeCell({ account: a, row }: AccountTypeCellProps) {
  const { editing } = row
  if (editing?.id !== a.id) return <>{a.accountType.replace('_', ' ')}</>
  return (
    <select
      className="cat-cell__select"
      aria-label={`Type of ${a.name}`}
      value={editing.accountType}
      onChange={(e) => row.change({ ...editing, accountType: e.target.value })}
    >
      {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
    </select>
  )
}
