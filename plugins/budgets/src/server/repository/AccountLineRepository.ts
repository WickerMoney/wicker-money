import type { AccountLineRow } from './AccountLineRow.js'
import type { ExportedAccountLine } from './ExportedAccountLine.js'
import type { NewAccountLine } from './NewAccountLine.js'

/**
 * Storage for a user's account lines: one allowance per account per calendar
 * month (see migration 027).
 *
 * Every method sees only the calling user's rows; the transaction it runs in
 * is already bound to that user.
 */
export interface AccountLineRepository {
  /**
   * @param monthKey - The month as `YYYY-MM`.
   * @returns The month's account lines ordered by account id; empty when the month has none.
   */
  listForMonth(monthKey: string): Promise<AccountLineRow[]>

  /**
   * Creates the line, or updates the one already stored for that account and month.
   *
   * @param line - The line to store.
   * @returns The stored line, or `undefined` if the write returned no row.
   */
  upsert(line: NewAccountLine): Promise<AccountLineRow | undefined>

  /**
   * Copies every account line of one month into another in a single
   * statement, leaving untouched any account that already has a line there.
   *
   * @param sourceMonth - The month to copy from, `YYYY-MM`.
   * @param targetMonth - The month to copy into, `YYYY-MM`.
   * @returns How many lines were created.
   */
  copyMonth(sourceMonth: string, targetMonth: string): Promise<number>

  /**
   * @param accountId - The account whose line is removed.
   * @param monthKey - The month as `YYYY-MM`.
   * @returns How many lines were deleted: 0 when there was none, or when it belongs to someone else.
   */
  deleteForMonth(accountId: string, monthKey: string): Promise<number>

  /** @returns Every account line the user has, ordered by start then account id, for the data export. */
  listAll(): Promise<ExportedAccountLine[]>
}
