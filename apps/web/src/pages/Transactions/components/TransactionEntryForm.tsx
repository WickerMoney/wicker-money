import { useState } from 'react'
import { EmptyState, Surface } from '@wickermoney/ui-kit'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Account, Category } from '../../../models/index.js'
import { useEntryFields } from '../hooks/useEntryFields.js'
import { useSpendEntry } from '../hooks/useSpendEntry.js'
import { useTransferEntry } from '../hooks/useTransferEntry.js'
import type { EntryMode } from '../state/EntryMode.js'
import { EntryModeToggle } from './EntryModeToggle.js'
import { SpendForm } from './SpendForm.js'
import { TransferForm } from './TransferForm.js'

/** Props for {@link TransactionEntryForm}. */
export interface TransactionEntryFormProps {
  /** Accounts a transaction can be recorded against. */
  readonly accounts: readonly Account[]
  /** Categories offered for the new transaction. */
  readonly enabledCategories: readonly Category[]
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after an entry is recorded so the list can be re-read. */
  readonly onRecorded: () => Promise<void>
}

/**
 * A form that records either a spending/income transaction or a transfer
 * between two of the user's accounts.
 *
 * The two are separate modes because a transfer is two linked rows, not a
 * transaction with an unusual category. Before transfers could be entered
 * directly, people typed them as ordinary spending and every amount moved to
 * savings was counted as money spent.
 */
export function TransactionEntryForm({
  accounts, enabledCategories, status, onRecorded,
}: TransactionEntryFormProps) {
  const [mode, setMode] = useState<EntryMode>('spend')
  const fields = useEntryFields(accounts)
  const spend = useSpendEntry(fields, status, onRecorded)
  const transfer = useTransferEntry(fields, status, onRecorded)

  return (
    <Surface title={mode === 'transfer' ? 'Move money' : 'Record a transaction'}>
      {accounts.length === 0 ? (
        <EmptyState title="Add an account first" hint="Transactions belong to an account." />
      ) : (
        <>
          <EntryModeToggle mode={mode} onChange={setMode} />
          {mode === 'transfer' ? (
            <TransferForm accounts={accounts} fields={fields} entry={transfer} busy={status.busy} />
          ) : (
            <SpendForm
              accounts={accounts} enabledCategories={enabledCategories}
              fields={fields} entry={spend} busy={status.busy}
            />
          )}
        </>
      )}
    </Surface>
  )
}
