import { addDays } from '@wickermoney/plugin-sdk/recurrence'
import { monthPeriod } from '../../shared/index.js'
import type { AccountRow } from '../repository/AccountRow.js'
import type { CategoryRow } from '../repository/CategoryRow.js'
import type { AccountTransaction } from './AccountTransaction.js'
import type { SpendEntry } from './SpendEntry.js'
import type { StoredAccountLine } from './StoredAccountLine.js'
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
  accounts: AccountRow[] = []
  accountLines: StoredAccountLine[] = []
  accountTransactions: AccountTransaction[] = []
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

  /**
   * Adds an account.
   *
   * @param id - Account id.
   * @param name - Display name.
   * @param accountType - The account type; defaults to `checking`.
   */
  addAccount(id: string, name: string, accountType = 'checking'): void {
    this.accounts.push({ id, name, account_type: accountType })
  }

  /**
   * Adds a stored account line without counting it as a write.
   *
   * @param userId - The owner.
   * @param monthKey - The month, `YYYY-MM`.
   * @param accountId - The account.
   * @param planned - Planned amount as a decimal string.
   * @param options - Rollover (default on), excluded categories and note.
   * @returns The stored line.
   */
  addAccountLine(
    userId: string,
    monthKey: string,
    accountId: string,
    planned: string,
    options: { rollover?: boolean; excluded?: readonly string[]; note?: string | null } = {},
  ): StoredAccountLine {
    const line: StoredAccountLine = {
      id: this.newId(),
      userId,
      account_id: accountId,
      period_start: `${monthKey}-01`,
      period_end: monthPeriod(monthKey).end,
      planned,
      rollover: options.rollover ?? true,
      excluded_category_ids: [...(options.excluded ?? [])],
      note: options.note ?? null,
    }
    this.accountLines.push(line)
    return line
  }

  /**
   * Seeds one transaction on an account.
   *
   * @param userId - The owner.
   * @param accountId - The account.
   * @param date - The transaction date, `YYYY-MM-DD`.
   * @param amount - Signed amount as a decimal string; negative is money out.
   * @param categoryId - The category, or `null` for none.
   */
  addAccountTransaction(
    userId: string,
    accountId: string,
    date: string,
    amount: string,
    categoryId: string | null = null,
  ): void {
    this.accountTransactions.push({ userId, accountId, date, amount, categoryId })
  }
}
