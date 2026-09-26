import type { CategorySource } from '../../db/models/index.js'

/**
 * Columns to change on a transaction. Absent fields are left as they are, so
 * `null` is a real value (clear it) and `undefined` means "do not touch".
 */
export interface TransactionChanges {
  readonly amount?: string
  readonly merchant?: string
  readonly transactionDate?: string
  readonly notes?: string | null
  readonly categoryId?: string | null
  /** Must be set together with `categoryId`: null exactly when the category is cleared. */
  readonly categorySource?: CategorySource | null
}
