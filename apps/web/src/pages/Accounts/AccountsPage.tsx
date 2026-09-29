import { useState } from 'react'
import { Alert } from '@wickermoney/ui-kit'
import { useActionStatus } from '../../hooks/useActionStatus.js'
import { AccountsPanel } from './components/AccountsPanel.js'
import { AddAccountForm } from './components/AddAccountForm.js'
import { DeleteAccountPanel } from './components/DeleteAccountPanel.js'
import { FixOpeningBalancePanel } from './components/FixOpeningBalancePanel.js'
import { useAccountDeletion } from './hooks/useAccountDeletion.js'
import { useAccountList } from './hooks/useAccountList.js'
import { useOpeningBalanceFix } from './hooks/useOpeningBalanceFix.js'

/**
 * Account management: list, rename, add, correct an opening balance, archive
 * and delete.
 *
 * Correcting an opening balance and deleting an account with history each get
 * their own panel and preview rather than living behind an ordinary edit,
 * because both change more than the row they are started from.
 */
export function AccountsPage() {
  const status = useActionStatus()
  const [notice, setNotice] = useState<string | null>(null)
  const { accounts, includeArchived, setIncludeArchived, reload } = useAccountList(status)
  const fix = useOpeningBalanceFix(status, reload, setNotice)
  const deletion = useAccountDeletion(status, accounts, reload, setNotice)

  return (
    <div className="page">
      <h1 className="page__title">Accounts</h1>
      {status.message !== null ? <Alert>{status.message}</Alert> : null}
      {notice !== null ? <Alert>{notice}</Alert> : null}

      <div className="page__split acct-split">
        <AccountsPanel
          accounts={accounts}
          includeArchived={includeArchived}
          onIncludeArchivedChange={setIncludeArchived}
          status={status}
          onChanged={reload}
          onFixOpeningBalance={(a) => { fix.open(a); deletion.dismiss() }}
          onArchive={(a) => void deletion.archive(a)}
          onDelete={(a) => void deletion.startDelete(a)}
        />
        <AddAccountForm status={status} onCreated={reload} />
      </div>

      {fix.fixing !== null ? (
        <FixOpeningBalancePanel
          account={fix.fixing}
          balanceInput={fix.balanceInput}
          preview={fix.balancePreview}
          busy={status.busy}
          onInputChange={(value) => void fix.preview(value)}
          onApply={() => void fix.apply()}
          onCancel={fix.cancel}
        />
      ) : null}

      <DeleteAccountPanel deletion={deletion} busy={status.busy} />
    </div>
  )
}
