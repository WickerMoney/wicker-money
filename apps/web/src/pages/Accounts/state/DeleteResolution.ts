import type { Account, AccountUsage, RecurringItem } from '../../../models/index.js'

/**
 * An account whose delete was refused because it still has history, together
 * with what that history is. Exists only while the user is choosing what to do.
 */
export interface DeleteResolution {
  /** The account the user tried to delete. */
  readonly account: Account
  /** What references the account. */
  readonly usage: AccountUsage
  /**
   * The recurring items with a leg on the account, ended ones included, so
   * the choice can name them: deleting removes each whole (a split paycheck
   * too), moving re-points them.
   */
  readonly recurringItems: readonly RecurringItem[]
}
