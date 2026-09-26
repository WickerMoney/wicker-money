import type { MigrationCounts } from '../repository/MigrationCounts.js'
import type { MigrationPlan } from './MigrationPlan.js'

/**
 * Decides what a history migration does with each kind of row.
 *
 * A transfer recorded *between the two accounts* becomes a transfer from an
 * account to itself once they are the same account. That is meaningless, and
 * the ledger refuses it outright, so those rows are removed; everything else
 * referring to the source account is moved.
 *
 * @param counts - Rows found referring to the source account, split into transfers to the target and the rest.
 * @returns The plan, including the total a caller must confirm.
 */
export function planMigration(counts: MigrationCounts): MigrationPlan {
  return {
    removedTransferTransactions: counts.transferTransactions,
    removedTransferRecurringItems: counts.transferRecurringItems,
    movedTransactions: counts.otherTransactions,
    movedRecurringItems: counts.otherRecurringItems,
    totalAffected:
      counts.transferTransactions +
      counts.transferRecurringItems +
      counts.otherTransactions +
      counts.otherRecurringItems,
  }
}
