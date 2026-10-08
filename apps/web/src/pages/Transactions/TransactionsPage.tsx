import { useState } from 'react'
import { Alert, Button, Dialog } from '@wickermoney/ui-kit'
import { useActionStatus } from '../../hooks/useActionStatus.js'
import { TransactionEntryForm } from './components/TransactionEntryForm.js'
import { TransactionsPanel } from './components/TransactionsPanel.js'
import { useReferenceData } from './hooks/useReferenceData.js'
import { useTransactionList } from './hooks/useTransactionList.js'

/**
 * The ledger: a filterable, pageable transaction list, with a button that opens
 * a form for recording new spending, income and transfers.
 *
 * Recording and editing both happen in dialogs rather than beside the list, so
 * the table has the whole page width.
 *
 * Filters and paging matter because the list otherwise shows only the newest
 * page. Anything older would be unreachable, which is the difference between a
 * record you can look things up in and a feed.
 */
export function TransactionsPage() {
  const status = useActionStatus()
  const reference = useReferenceData(status)
  const list = useTransactionList(status)
  const [adding, setAdding] = useState(false)

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Transactions</h1>
        <Button variant="primary" onClick={() => setAdding(true)}>Add transaction</Button>
      </div>
      {status.message !== null ? <Alert>{status.message}</Alert> : null}

      <TransactionsPanel list={list} reference={reference} status={status} />

      {adding ? (
        <Dialog title="Add a transaction" onClose={() => setAdding(false)}>
          <TransactionEntryForm
            accounts={reference.accounts}
            enabledCategories={reference.enabledCategories}
            status={status}
            onRecorded={list.reload}
          />
        </Dialog>
      ) : null}
    </div>
  )
}
