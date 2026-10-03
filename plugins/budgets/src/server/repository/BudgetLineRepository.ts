import type { BudgetLineRow } from './BudgetLineRow.js'
import type { ExportedBudgetLine } from './ExportedBudgetLine.js'
import type { NewBudgetLine } from './NewBudgetLine.js'
import type { NewWindow } from './NewWindow.js'
import type { SavedBudgetLine } from './SavedBudgetLine.js'
import type { WindowRow } from './WindowRow.js'

/**
 * Storage for a user's budget lines: monthly lines, one per category per
 * month, and windows, which span any other date range (see `shared/window.ts`).
 *
 * The month methods see monthly lines only and the window methods see windows
 * only, so a window never shows up as a month's own line or gets copied into
 * the next month.
 *
 * No category ever has two lines covering the same day; the database refuses
 * the write with PostgreSQL's exclusion-violation error (`23P01`), which the
 * service turns into a `409`.
 *
 * Every method sees only the calling user's rows; the transaction it runs in
 * is already bound to that user.
 */
export interface BudgetLineRepository {
  /**
   * @param monthKey - The month as `YYYY-MM`.
   * @returns The month's monthly lines ordered by category id; empty when the month has no plan.
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
   * Copies every monthly line of one month into another in a single statement,
   * leaving untouched any category that already has a line in the target
   * month or a window overlapping it.
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

  /** @returns Every line the user has, windows included, ordered by start then category id, for the data export. */
  listAll(): Promise<ExportedBudgetLine[]>

  /**
   * @param monthKey - The month as `YYYY-MM`.
   * @returns Windows overlapping any day of the month, ordered by category id then start.
   */
  listWindows(monthKey: string): Promise<WindowRow[]>

  /**
   * @param window - The window to create.
   * @returns The stored window, or `undefined` if the write returned no row.
   */
  insertWindow(window: NewWindow): Promise<WindowRow | undefined>

  /**
   * @param id - The window to change.
   * @param window - Its new category, dates, amount and note.
   * @returns The stored window, or `undefined` when there is no such window
   *   for this user (including one that belongs to someone else).
   */
  updateWindow(id: string, window: NewWindow): Promise<WindowRow | undefined>

  /**
   * @param id - The window to remove.
   * @returns How many windows were deleted: 0 when there was none, when it
   *   belongs to someone else, or when the id is a monthly line's.
   */
  deleteWindow(id: string): Promise<number>
}
