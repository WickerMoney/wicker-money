import type { CandidateSearch } from './CandidateSearch.js'
import type { CandidateTransactionRow } from './CandidateTransactionRow.js'
import type { DismissalRow } from './DismissalRow.js'
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

/** Which dismissals to read. Every given condition must hold. */
export interface DismissalFilter {
  /** Only dismissals of these transactions. */
  readonly transactionIds?: readonly string[]
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
   * Lists the unlinked transactions on some accounts in a date range, for
   * matching. A transaction already settling an occurrence is not a candidate
   * for another, so it is left out here rather than filtered afterwards.
   *
   * The cap applies to each account separately and keeps the newest rows; an
   * account the cap cut short is named in `truncatedAccounts`.
   *
   * @param accountIds - Accounts to look on.
   * @param from - First date, inclusive.
   * @param through - Last date, inclusive.
   * @returns Transactions ordered by date, then id (at most a few hundred per account), and the accounts that had more.
   */
  findCandidates(accountIds: readonly string[], from: string, through: string): Promise<CandidateSearch>

  /**
   * Points transactions at an occurrence, or unlinks them.
   *
   * @param transactionIds - Transactions.
   * @param occurrenceId - The occurrence's row, or `null` to unlink.
   */
  setLink(transactionIds: readonly string[], occurrenceId: string | null): Promise<void>

  /**
   * Reads occurrence rows by id: which item and nominal date each one is.
   *
   * @param ids - Occurrence row ids, as `transactions.recurring_occurrence_id` holds them.
   * @returns The ones visible to this user.
   */
  findRecordsById(ids: readonly string[]): Promise<{ id: string; recurring_item_id: string; nominal_date: string }[]>

  /**
   * Lists dismissed suggestions.
   *
   * @param filter - Which ones.
   * @returns Dismissals ordered by item, nominal date, then transaction.
   */
  listDismissals(filter: DismissalFilter): Promise<DismissalRow[]>

  /**
   * Records that a transaction is not an occurrence. Doing it twice is a no-op.
   *
   * @param userId - Owner.
   * @param transactionId - The transaction.
   * @param itemId - The occurrence's item.
   * @param nominalDate - The occurrence's nominal date.
   */
  addDismissal(userId: string, transactionId: string, itemId: string, nominalDate: string): Promise<void>

  /**
   * Forgets dismissals of an occurrence, so the transactions can be suggested for it again.
   *
   * @param transactionIds - The transactions.
   * @param itemId - The occurrence's item.
   * @param nominalDate - The occurrence's nominal date.
   * @returns How many were deleted.
   */
  removeDismissals(transactionIds: readonly string[], itemId: string, nominalDate: string): Promise<number>
}
