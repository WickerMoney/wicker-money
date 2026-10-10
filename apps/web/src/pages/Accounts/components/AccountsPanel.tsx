import { EmptyState, Spinner, Surface, Table } from '@wickermoney/ui-kit'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Account } from '../../../models/index.js'
import { useAccountEditing } from '../hooks/useAccountEditing.js'
import { AccountActionsCell } from './AccountActionsCell.js'
import { AccountBufferCell } from './AccountBufferCell.js'
import { AccountCurrencyCell } from './AccountCurrencyCell.js'
import { AccountNameCell } from './AccountNameCell.js'
import { AccountSpendableCell } from './AccountSpendableCell.js'
import { AccountTypeCell } from './AccountTypeCell.js'

/** Props for {@link AccountsPanel}. */
export interface AccountsPanelProps {
  /** `null` while the first load is in flight. */
  readonly accounts: readonly Account[] | null
  /** Whether archived accounts are listed. */
  readonly includeArchived: boolean
  /** Called when the archived toggle changes. */
  readonly onIncludeArchivedChange: (include: boolean) => void
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after a rename or re-type so the list can be re-read. */
  readonly onChanged: () => Promise<void>
  /** Called to open the opening-balance correction for an account. */
  readonly onFixOpeningBalance: (account: Account) => void
  /** Called to archive an account. */
  readonly onArchive: (account: Account) => void
  /** Called to start deleting an account. */
  readonly onDelete: (account: Account) => void
}

/**
 * The accounts table, with inline rename, re-type, re-currency and buffer,
 * a "counts toward safe to spend" checkbox, plus per-row actions.
 */
export function AccountsPanel({
  accounts, includeArchived, onIncludeArchivedChange, status, onChanged,
  onFixOpeningBalance, onArchive, onDelete,
}: AccountsPanelProps) {
  const row = useAccountEditing(status, onChanged)
  const busy = status.busy

  return (
    <Surface title="Your accounts">
      <label className="check">
        <input type="checkbox" checked={includeArchived}
               onChange={(e) => onIncludeArchivedChange(e.target.checked)} />
        <span>Show archived accounts</span>
      </label>

      {accounts === null ? <Spinner /> : (
        <Table
          caption="Accounts"
          className="tbl-cards"
          columns={[
            { key: 'name', header: 'Name',
              render: (a: Account) => <AccountNameCell account={a} row={row} /> },
            { key: 'type', header: 'Type',
              render: (a: Account) => <AccountTypeCell account={a} row={row} /> },
            { key: 'currency', header: 'Currency',
              render: (a: Account) => <AccountCurrencyCell account={a} row={row} /> },
            { key: 'bal', header: 'Balance', numeric: true,
              render: (a: Account) => formatMoney(a.balance, a.currencyCode) },
            { key: 'buffer', header: 'Buffer', numeric: true,
              render: (a: Account) => <AccountBufferCell account={a} row={row} /> },
            { key: 'spendable', header: 'Safe to spend',
              render: (a: Account) => <AccountSpendableCell account={a} row={row} busy={busy} /> },
            { key: 'actions', header: '',
              render: (a: Account) => (
                <AccountActionsCell
                  account={a} row={row} busy={busy}
                  onFixOpeningBalance={onFixOpeningBalance} onArchive={onArchive} onDelete={onDelete}
                />
              ) },
          ]}
          rows={accounts}
          rowKey={(a) => a.id}
          empty={<EmptyState title="No accounts yet" hint="Add one to start recording transactions." />}
        />
      )}
    </Surface>
  )
}
