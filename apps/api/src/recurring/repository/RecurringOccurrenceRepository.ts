import type { CandidateTransactionRow } from './CandidateTransactionRow.js'
import type { OccurrenceLinkRow } from './OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from './OccurrenceRecordRow.js'

/** Which recorded occurrences to read. Both bounds are on the nominal date. */
export interface OccurrenceFilter {
  /** Only this item's. */
  readonly itemId?: string
  /** Nominal date on or after, `YYYY-MM-DD`. */
  readonly from?: string
  /** Nominal date before, `YYYY-MM-DD`. */
  readonly to?: string
}

/**
 * Persistence for what was recorded about single occurrences of recurring
 * items (skipped, moved, a different amount) and for the links from ledger
 * transactions to the occurrences they settle.
 *
 * Every method runs inside the unit of work's transaction under the acting
 * user's row-level security.
 */
export interface RecurringOccurrenceRepository {
  /**
   * Lists recorded occurrences.
   *
   * @param filter - Which ones.
   * @returns Records ordered by item, then nominal date.
   */
  listRecords(filter: OccurrenceFilter): Promise<OccurrenceRecordRow[]>

  /**
   * Lists the transactions settling occurrences.
   *
   * @param filter - Which occurrences, by the same rules as {@link listRecords}.
   * @returns Links ordered by item, nominal date, then account.
   */
  listLinks(filter: OccurrenceFilter): Promise<OccurrenceLinkRow[]>

  /**
   * When tracking started for each item that has ever had an occurrence
   * settled by a transaction: the earliest such occurrence's nominal date.
   * Matching is opt-in per item: until an item has been matched once, and
   * for occurrences before the first one matched, past occurrences are
   * assumed to have posted.
   *
   * @returns Item id to `YYYY-MM-DD`.
   */
  trackingStarts(): Promise<Map<string, string>>

  /**
   * Finds an occurrence's row, creating an empty one if none exists.
   *
   * @param userId - Owner, for a new row.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @returns The row's id.
   */
  ensure(userId: string, itemId: string, nominalDate: string): Promise<string>

  /**
   * Replaces what is recorded about an occurrence: its skip and move, and its
   * per-account amounts.
   *
   * @param userId - Owner, for new amount rows.
   * @param occurrenceId - The occurrence's row.
   * @param record - The new state; `legs` holds only accounts whose amount differs from the item's.
   */
  write(
    userId: string,
    occurrenceId: string,
    record: {
      readonly skipped: boolean
      readonly expectedDate: string | null
      readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
    },
  ): Promise<void>

  /**
   * Deletes an occurrence's row if nothing is recorded on it any more: not
   * skipped, not moved, no amounts, and no transaction settling it. Keeps
   * the table to occurrences that differ from their series.
   *
   * @param occurrenceId - The occurrence's row.
   */
  deleteIfEmpty(occurrenceId: string): Promise<void>

  /**
   * Deletes the per-occurrence amounts of an item that no longer fit its
   * legs: on an account the item has no leg on, or with the opposite sign
   * to the leg. Called after the item is rewritten.
   *
   * @param itemId - The item.
   * @returns How many were deleted.
   */
  pruneAmounts(itemId: string): Promise<number>

  /**
   * Reads transactions by id.
   *
   * @param ids - Transaction ids.
   * @returns The ones visible to this user.
   */
  findTransactions(ids: readonly string[]): Promise<CandidateTransactionRow[]>

  /**
   * Reads the other row of each transfer.
   *
   * @param transferId - The transfer.
   * @returns Both rows.
   */
  findTransferRows(transferId: string): Promise<CandidateTransactionRow[]>

  /**
   * Lists transactions on some accounts in a date range, for matching.
   *
   * @param accountIds - Accounts to look on.
   * @param from - First date, inclusive.
   * @param through - Last date, inclusive.
   * @returns Transactions ordered by date, then id; at most a few hundred.
   */
  findCandidates(accountIds: readonly string[], from: string, through: string): Promise<CandidateTransactionRow[]>

  /**
   * Points transactions at an occurrence, or unlinks them.
   *
   * @param transactionIds - Transactions.
   * @param occurrenceId - The occurrence's row, or `null` to unlink.
   */
  setLink(transactionIds: readonly string[], occurrenceId: string | null): Promise<void>
}
