import type { BudgetLineRow } from './BudgetLineRow.js'
import type { ExportedBudgetLine } from './ExportedBudgetLine.js'
import type { NewBudgetLine } from './NewBudgetLine.js'
import type { SavedBudgetLine } from './SavedBudgetLine.js'

/**
 * Storage for a user's budget lines, one per category per month.
 *
 * Every method sees only the calling user's rows; the transaction it runs in
 * is already bound to that user.
 */
export interface BudgetLineRepository {
  /**
   * @param monthKey - The month as `YYYY-MM`.
   * @returns The month's lines ordered by category id; empty when the month has no plan.
   */
  listForMonth(monthKey: string): Promise<BudgetLineRow[]>

  /**
   * Creates the line, or updates the one already stored for that category and month.
   *
   * @param line - The line to store.
   * @returns The stored line, or `undefined` if the write returned no row.
   */
  upsert(line: NewBudgetLine): Promise<SavedBudgetLine | undefined>

  /**
   * Copies every line of one month into another in a single statement, leaving
   * any category that already has a line in the target month untouched.
   *
   * @param sourceMonth - The month to copy from, `YYYY-MM`.
   * @param targetMonth - The month to copy into, `YYYY-MM`.
   * @returns How many lines were created.
   */
  copyMonth(sourceMonth: string, targetMonth: string): Promise<number>

  /**
   * @param categoryId - The category whose line is removed.
   * @param monthKey - The month as `YYYY-MM`.
   * @returns How many lines were deleted: 0 when there was none, or when it belongs to someone else.
   */
  deleteForMonth(categoryId: string, monthKey: string): Promise<number>

  /** @returns Every line the user has, ordered by month then category id, for the data export. */
  listAll(): Promise<ExportedBudgetLine[]>
}
