import { Alert } from '@wickermoney/ui-kit'
import { useActionStatus } from '../../hooks/useActionStatus.js'
import { TransactionEntryForm } from './components/TransactionEntryForm.js'
import { TransactionsPanel } from './components/TransactionsPanel.js'
import { useReferenceData } from './hooks/useReferenceData.js'
import { useTransactionList } from './hooks/useTransactionList.js'

/**
 * The ledger: a filterable, pageable transaction list beside a form for
 * recording new spending, income and transfers.
 *
 * Filters and paging matter because the list otherwise shows only the newest
 * page. Anything older would be unreachable, which is the difference between a
 * record you can look things up in and a feed.
 */
export function TransactionsPage() {
  const status = useActionStatus()
  const reference = useReferenceData(status)
  const list = useTransactionList(status)

  return (
    <div className="page">
      <h1 className="page__title">Transactions</h1>
      {status.message !== null ? <Alert>{status.message}</Alert> : null}

      <div className="page__split">
        <TransactionsPanel list={list} reference={reference} status={status} />
        <TransactionEntryForm
          accounts={reference.accounts}
          enabledCategories={reference.enabledCategories}
          status={status}
          onRecorded={list.reload}
        />
      </div>
    </div>
  )
}
