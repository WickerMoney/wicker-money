import type { ExistingTransaction } from './ExistingTransaction.js'

/** One existing transaction with the comparison values computed once. */
export interface IndexedTransaction {
  readonly transaction: ExistingTransaction
  /** Position in the input list; the earliest match wins, as in a linear scan. */
  readonly order: number
  readonly merchant: string
}
