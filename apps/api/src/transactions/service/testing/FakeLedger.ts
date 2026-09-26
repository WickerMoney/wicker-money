import type { MatchRule } from '../../../categories/engine.js'
import type { Transaction, TransactionSplit } from '../../../db/models/index.js'

/** An account or category row in the fake ledger, tagged with its owner. */
export interface FakeOwned {
  readonly id: string
  readonly userId: string
  readonly name: string
  /** For a category: the parent it is filed under, if any. */
  readonly parentId?: string
}

/** The whole state the in-memory repositories operate on. */
export interface FakeLedger {
  accounts: FakeOwned[]
  categories: FakeOwned[]
  transactions: Transaction[]
  splits: TransactionSplit[]
  /** Rules returned by `fetchForMatching`, in resolution order. */
  rules: MatchRule[]
}
