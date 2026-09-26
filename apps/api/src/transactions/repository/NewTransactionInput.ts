import type { CategorySource } from '../../db/models/index.js'

/** Fields required to insert a single, non-transfer transaction. */
export interface NewTransactionInput {
  readonly userId: string
  readonly accountId: string
  /** Signed decimal string. */
  readonly amount: string
  readonly merchant: string
  /** `YYYY-MM-DD`. */
  readonly transactionDate: string
  readonly categoryId: string | null
  /** How the category was chosen; null exactly when `categoryId` is null. */
  readonly categorySource: CategorySource | null
  readonly notes: string | null
  readonly externalId: string | null
}
