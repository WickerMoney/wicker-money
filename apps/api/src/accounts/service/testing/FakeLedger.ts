import type { AccountWithBalance } from '../../repository/AccountWithBalance.js'

/** A ledger row in the in-memory fake, on either the transactions or the recurring-items side. */
export interface FakeLedgerRow {
  readonly id: string
  readonly userId: string
  accountId: string
  transferAccountId: string | null
  readonly amount: string
  readonly externalId: string | null
}

/** An account in the in-memory fake, including its owner. */
export interface FakeAccountRow extends Omit<AccountWithBalance, 'balance'> {
  userId: string
}

/** The complete state of the in-memory database used by service unit tests. */
export interface FakeLedger {
  accounts: FakeAccountRow[]
  transactions: FakeLedgerRow[]
  recurringItems: FakeLedgerRow[]
}
