import { useState } from 'react'
import { Alert, Button, Dialog } from '@wickermoney/ui-kit'
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
 * Adding, correcting an opening balance and deleting an account with history
 * each open in a dialog, as on the Transactions page. The last two get their
 * own preview rather than living behind an ordinary edit,
 * because both change more than the row they are started from.
 */
export function AccountsPage() {
  const status = useActionStatus()
  const [notice, setNotice] = useState<string | null>(null)
  const { accounts, includeArchived, setIncludeArchived, reload } = useAccountList(status)
  const fix = useOpeningBalanceFix(status, reload, setNotice)
  const deletion = useAccountDeletion(status, accounts, reload, setNotice)
  const [adding, setAdding] = useState(false)

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Accounts</h1>
        <Button variant="primary" onClick={() => setAdding(true)}>Add account</Button>
      </div>
      {status.message !== null ? <Alert>{status.message}</Alert> : null}
      {notice !== null ? <Alert>{notice}</Alert> : null}

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

      {adding ? (
        <Dialog title="Add an account" onClose={() => setAdding(false)}>
          <AddAccountForm
            status={status}
            onCreated={async () => { await reload(); setAdding(false) }}
          />
        </Dialog>
      ) : null}

      {fix.fixing !== null ? (
        <FixOpeningBalancePanel
          account={fix.fixing}
          balanceInput={fix.balanceInput}
          preview={fix.balancePreview}
          errors={fix.errors}
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
