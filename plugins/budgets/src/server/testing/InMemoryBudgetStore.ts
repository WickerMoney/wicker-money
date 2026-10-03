import { addDays, monthPeriod } from '../../shared/index.js'
import type { CategoryRow } from '../repository/CategoryRow.js'
import type { SpendEntry } from './SpendEntry.js'
import type { StoredLine } from './StoredLine.js'

/**
 * The data behind the in-memory repositories, shared by every user's view of it.
 *
 * Each repository is handed a user id and filters by it, the way row-level
 * security narrows every real query, so a test can check isolation between
 * users without a database.
 */
export class InMemoryBudgetStore {
  lines: StoredLine[] = []
  spend: SpendEntry[] = []
  categories: CategoryRow[] = []
  /** Number of write operations performed; a read path must leave this at zero. */
  writes = 0
  /** When true the next `upsert` returns no row, like a write that produced nothing. */
  failNextUpsert = false
  private nextId = 1

  /** @returns A fresh unique id for a stored line. */
  newId(): string {
    return `line-${this.nextId++}`
  }

  /**
   * Adds a category.
   *
   * @param id - Category id.
   * @param name - Display name.
   */
  addCategory(id: string, name: string): void {
    this.categories.push({ id, name, parent_id: null })
  }

  /**
   * Adds a stored budget line without counting it as a write.
   *
   * @param userId - The owner.
   * @param monthKey - The month, `YYYY-MM`.
   * @param categoryId - The category budgeted.
   * @param planned - Planned amount as a decimal string.
   * @param options - Rollover flag and note.
   * @returns The stored line.
   */
  addLine(
    userId: string,
    monthKey: string,
    categoryId: string,
    planned: string,
    options: { rollover?: boolean; note?: string | null } = {},
  ): StoredLine {
    const line: StoredLine = {
      id: this.newId(),
      userId,
      category_id: categoryId,
      period_start: `${monthKey}-01`,
      period_end: monthPeriod(monthKey).end,
      planned,
      rollover: options.rollover ?? false,
      note: options.note ?? null,
    }
    this.lines.push(line)
    return line
  }

  /**
   * Adds a stored window without counting it as a write.
   *
   * @param userId - The owner.
   * @param categoryId - The category budgeted.
   * @param start - First day, `YYYY-MM-DD`.
   * @param through - Last day, inclusive, `YYYY-MM-DD`.
   * @param planned - Funded amount as a decimal string.
   * @returns The stored window.
   */
  addWindow(userId: string, categoryId: string, start: string, through: string, planned: string): StoredLine {
    const line: StoredLine = {
      id: this.newId(),
      userId,
      category_id: categoryId,
      period_start: start,
      period_end: addDays(through, 1),
      planned,
      rollover: false,
      note: null,
    }
    this.lines.push(line)
    return line
  }

  /**
   * Seeds net spend for a category in a month.
   *
   * @param userId - The owner.
   * @param monthKey - The month, `YYYY-MM`.
   * @param categoryId - The category.
   * @param spent - Net spend as a decimal string.
   */
  addSpend(userId: string, monthKey: string, categoryId: string, spent: string): void {
    this.spend.push({ userId, categoryId, monthKey, spent })
  }
}
