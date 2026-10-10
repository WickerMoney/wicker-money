import { compareMoney, subtractMoney, sumMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import { addDays } from '@wickermoney/plugin-sdk/date'
import {
  ACCOUNT_LINE_TYPES, draftPlannedFrom, monthKeyOf, monthPeriod, previousMonth, rankAtRisk, rankBreakdown,
  todayIn, windowIssue, type LineStatus,
} from '../../shared/index.js'
import type { BudgetRepositories } from '../repository/BudgetRepositories.js'
import type { BudgetUnitOfWork } from '../repository/BudgetUnitOfWork.js'
import type { AccountLineInput } from './AccountLineInput.js'
import { accountMonthLines } from './accountMonthLines.js'
import type { AdoptResult } from './AdoptResult.js'
import type { AtRiskReport } from './AtRiskReport.js'
import { BudgetError } from './BudgetError.js'
import { categoryNames } from './categoryNames.js'
import type { Clock } from './Clock.js'
import type { DeleteResult } from './DeleteResult.js'
import { findUnbudgeted } from './findUnbudgeted.js'
import { isOverlapError } from './isOverlapError.js'
import type { LineInput } from './LineInput.js'
import { lineStatusOf } from './lineStatusOf.js'
import type { MonthLine } from './MonthLine.js'
import type { MonthReport } from './MonthReport.js'
import { openingBalances } from './openingBalances.js'
import type { SavedAccountLine } from './SavedAccountLine.js'
import type { SavedLine } from './SavedLine.js'
import type { SavedWindow } from './SavedWindow.js'
import { summarizeMonth } from './summarizeMonth.js'
import { windowLines } from './windowLines.js'
import type { WindowInput } from './WindowInput.js'

/**
 * Business rules for monthly budgets.
 *
 * Nothing here stores `spent` or the carry-forward: both are derived from the
 * ledger and the budget history on every read, so the figures on the page
 * cannot disagree with the ledger, and a transaction imported late against an
 * old month corrects every month after it.
 */
export class BudgetService {
  /**
   * @param uow - Opens transactions and supplies repositories.
   * @param now - Supplies the current instant, used to decide which day is today.
   *   Defaults to the real clock; tests pass a fixed one.
   */
  constructor(
    private readonly uow: BudgetUnitOfWork,
    private readonly now: Clock = () => new Date(),
  ) {}

  /**
   * One month's lines, what was spent against them and what was spent without
   * being budgeted. Performs no writes.
   *
   * When the month has no lines yet, the previous month's are returned as a
   * draft: same categories and plans, no ids, nothing stored. Opening next
   * month to see what it looks like is a read, and a read must not write.
   *
   * @param userId - The signed-in user.
   * @param monthKey - The month as `YYYY-MM`.
   * @param timezone - The user's IANA zone, used to decide what today is.
   * @returns The month's report.
   */
  getMonth(userId: string, monthKey: string, timezone: string): Promise<MonthReport> {
    return this.uow.run(userId, async (repos) => {
      const nameOf = categoryNames(await repos.categories.list())
      const today = todayIn(timezone, this.now())

      // Windows are stored lines whatever the month's draft state: they were
      // planned once for their whole range, not month by month.
      const windows = await windowLines(repos, monthKey, today, nameOf)
      const covered = new Set(windows.lines.map((l) => l.categoryId))

      const own = await repos.lines.listForMonth(monthKey)
      const draft = own.length === 0
      // A draft never proposes a monthly line for a category a window already
      // covers this month; adopting it would be refused as an overlap anyway.
      const source = draft
        ? (await repos.lines.listForMonth(previousMonth(monthKey))).filter((l) => !covered.has(l.category_id))
        : own

      const spend = await repos.spend.byCategory(monthKey)

      // A draft has not happened yet, so it carries nothing in: the balance it
      // would inherit depends on how the current month actually ends.
      const carried = draft
        ? new Map<string, string>()
        : await openingBalances(
            repos.balances,
            monthKey,
            source.filter((l) => l.rollover).map((l) => l.category_id),
            spend,
          )

      const monthly: MonthLine[] = source.map((line) => {
        const carriedIn = carried.get(line.category_id) ?? ZERO_MONEY
        const status = lineStatusOf(
          {
            categoryId: line.category_id,
            categoryName: nameOf(line.category_id),
            planned: draft ? draftPlannedFrom(line) : line.planned,
            carriedIn,
            spent: spend.get(line.category_id) ?? ZERO_MONEY,
            rollover: line.rollover,
          },
          monthKey,
          today,
        )
        return { ...status, id: draft ? null : line.id, carriedIn, note: line.note, draft, window: null }
      })

      const lines = [...monthly, ...windows.lines].sort((a, b) => a.categoryId.localeCompare(b.categoryId))
      const accounts = await accountMonthLines(repos, monthKey, today, true)

      const unbudgeted = findUnbudgeted(
        outsideWindows(spend, windows.spentInMonth),
        new Set(monthly.map((l) => l.categoryId)),
        nameOf,
      )

      return {
        monthKey,
        period: monthPeriod(monthKey),
        today,
        draft,
        lines,
        accountLines: accounts.lines,
        unbudgeted,
        summary: summarizeMonth(lines, unbudgeted),
      }
    })
  }

  /**
   * Creates or updates one category's line for a month.
   *
   * An upsert rather than separate create and update: the client is editing a
   * cell in a month that may or may not exist yet, and this is also what turns
   * a draft month into stored rows.
   *
   * @param userId - The signed-in user.
   * @param input - The validated line.
   * @returns The stored line.
   * @throws {BudgetError} `500 not_saved` if the write returns no row.
   */
  upsertLine(userId: string, input: LineInput): Promise<SavedLine> {
    const { start, end } = monthPeriod(input.monthKey)
    return this.uow.run(userId, async (repos) => {
      const row = await refuseOverlap(
        repos.lines.upsert({
          categoryId: input.categoryId,
          periodStart: start,
          periodEnd: end,
          planned: input.planned,
          rollover: input.rollover,
          note: input.note,
        }),
        'This category has a window covering part of this month. Change or remove the window instead.',
      )
      if (row === undefined) throw new BudgetError('The line was not saved.', 500, 'not_saved')
      return { id: row.id, categoryId: row.category_id, planned: row.planned, rollover: row.rollover }
    })
  }

  /**
   * Creates a window, or updates one, when `input.id` is set.
   *
   * A window is one budget line over a date range that is not a calendar
   * month: funded once and spent down. See `shared/window.ts` for how it is
   * reported month by month.
   *
   * @param userId - The signed-in user.
   * @param input - The validated window.
   * @returns The stored window.
   * @throws {BudgetError} `400 bad_window` for dates that do not make a window,
   *   `404 not_found` when updating a window the caller does not have,
   *   `409 overlaps` when the category already has a line on any of those days,
   *   and `500 not_saved` if the write returns no row.
   */
  upsertWindow(userId: string, input: WindowInput): Promise<SavedWindow> {
    const issue = windowIssue(input.start, input.through)
    if (issue !== null) {
      return Promise.reject(new BudgetError(issue.message, 400, 'bad_window', [{ path: [issue.field], message: issue.message }]))
    }

    const window = {
      categoryId: input.categoryId,
      periodStart: input.start,
      periodEnd: addDays(input.through, 1),
      planned: input.planned,
      note: input.note,
    }
    return this.uow.run(userId, async (repos) => {
      const overlap =
        'This category already has a budget line on some of those days. Remove it, or pick dates that do not overlap.'
      const row = input.id === null
        ? await refuseOverlap(repos.lines.insertWindow(window), overlap)
        : await refuseOverlap(repos.lines.updateWindow(input.id, window), overlap)
      if (row === undefined) {
        throw input.id === null
          ? new BudgetError('The window was not saved.', 500, 'not_saved')
          : new BudgetError('There is no such window.', 404, 'not_found')
      }
      return {
        id: row.id,
        categoryId: row.category_id,
        start: row.period_start,
        through: addDays(row.period_end, -1),
        planned: row.planned,
      }
    })
  }

  /**
   * Removes a window.
   *
   * @param userId - The signed-in user.
   * @param id - The window to remove.
   * @returns How many rows were removed, always 1.
   * @throws {BudgetError} `404 not_found` if the caller has no such window,
   *   which includes another user's and a monthly line's id.
   */
  deleteWindow(userId: string, id: string): Promise<DeleteResult> {
    return this.uow.run(userId, async (repos) => {
      const removed = await repos.lines.deleteWindow(id)
      if (removed === 0) throw new BudgetError('There is no such window.', 404, 'not_found')
      return { removed }
    })
  }

  /**
   * Copies the previous month's lines into a month in one step.
   *
   * If the month already has lines nothing is written and their count is
   * reported, so a double click on a slow connection is not a failure.
   *
   * @param userId - The signed-in user.
   * @param monthKey - The month to fill, `YYYY-MM`.
   * @returns How many lines were created or already present.
   * @throws {BudgetError} `409 nothing_to_copy` if the previous month has no lines either.
   */
  adoptMonth(userId: string, monthKey: string): Promise<AdoptResult> {
    const previous = previousMonth(monthKey)
    return this.uow.run(userId, async (repos) => {
      // Category lines and account lines are copied independently: a month
      // can have its category lines and still be missing its allowance, such
      // as the month the allowance was first set up.
      const existing = await repos.lines.listForMonth(monthKey)
      const existingAccount = await repos.accountLines.listForMonth(monthKey)
      const sourceCount = existing.length === 0 ? (await repos.lines.listForMonth(previous)).length : 0
      const sourceAccountCount = existingAccount.length === 0
        ? (await repos.accountLines.listForMonth(previous)).length
        : 0

      if (sourceCount + sourceAccountCount === 0) {
        const planned = existing.length + existingAccount.length
        if (planned > 0) return { created: 0, alreadyPlanned: planned }
        throw new BudgetError(
          `There is nothing to copy — ${previous} has no budget either.`,
          409,
          'nothing_to_copy',
        )
      }
      const created =
        (sourceCount > 0 ? await repos.lines.copyMonth(previous, monthKey) : 0) +
        (sourceAccountCount > 0 ? await repos.accountLines.copyMonth(previous, monthKey) : 0)
      return { created, alreadyPlanned: 0 }
    })
  }

  /**
   * Removes one category's line for a month.
   *
   * Another user's line is indistinguishable from a missing one, because
   * row-level security hides it, so both are refused the same way and the
   * other user's line is left untouched.
   *
   * @param userId - The signed-in user.
   * @param monthKey - The month as `YYYY-MM`.
   * @param categoryId - The category whose line is removed.
   * @returns How many rows were removed, always 1.
   * @throws {BudgetError} `404 not_found` if the caller has no line for that category and month.
   */
  deleteLine(userId: string, monthKey: string, categoryId: string): Promise<DeleteResult> {
    return this.uow.run(userId, async (repos) => {
      const removed = await repos.lines.deleteForMonth(categoryId, monthKey)
      if (removed === 0) throw new BudgetError('There is no such budget line.', 404, 'not_found')
      return { removed }
    })
  }

  /**
   * Creates or updates one account's allowance for a month.
   *
   * An upsert, like {@link BudgetService.upsertLine}: the client edits a cell
   * in a month that may or may not exist yet.
   *
   * @param userId - The signed-in user.
   * @param input - The validated line.
   * @returns The stored line.
   * @throws {BudgetError} `400 bad_account` if the account is not one of the
   *   caller's checking accounts, `400 bad_excluded` if an excluded category is
   *   not one of the caller's, and `500 not_saved` if the write returns no row.
   */
  upsertAccountLine(userId: string, input: AccountLineInput): Promise<SavedAccountLine> {
    const { start, end } = monthPeriod(input.monthKey)
    return this.uow.run(userId, async (repos) => {
      const account = (await repos.accounts.list()).find((a) => a.id === input.accountId)
      if (account === undefined) {
        throw BudgetError.field('accountId', 'Choose one of your accounts.', 'bad_account')
      }
      if (!ACCOUNT_LINE_TYPES.includes(account.account_type)) {
        throw BudgetError.field('accountId', 'An allowance can be set on a checking account.', 'bad_account')
      }
      // The column has no foreign key (see migration 027), so this is the
      // check that keeps another user's category id out of it.
      const known = new Set((await repos.categories.list()).map((c) => c.id))
      if (input.excludedCategoryIds.some((id) => !known.has(id))) {
        throw BudgetError.field('excludedCategoryIds', 'Choose from your own categories.', 'bad_excluded')
      }

      const row = await repos.accountLines.upsert({
        accountId: input.accountId,
        periodStart: start,
        periodEnd: end,
        planned: input.planned,
        rollover: input.rollover,
        excludedCategoryIds: input.excludedCategoryIds,
        note: input.note,
      })
      if (row === undefined) throw new BudgetError('The line was not saved.', 500, 'not_saved')
      return {
        id: row.id,
        accountId: row.account_id,
        planned: row.planned,
        rollover: row.rollover,
        excludedCategoryIds: row.excluded_category_ids,
      }
    })
  }

  /**
   * Removes one account's allowance for a month.
   *
   * @param userId - The signed-in user.
   * @param monthKey - The month as `YYYY-MM`.
   * @param accountId - The account whose line is removed.
   * @returns How many rows were removed, always 1.
   * @throws {BudgetError} `404 not_found` if the caller has no line for that account and month.
   */
  deleteAccountLine(userId: string, monthKey: string, accountId: string): Promise<DeleteResult> {
    return this.uow.run(userId, async (repos) => {
      const removed = await repos.accountLines.deleteForMonth(accountId, monthKey)
      if (removed === 0) throw new BudgetError('There is no such account line.', 404, 'not_found')
      return { removed }
    })
  }

  /**
   * The current month's lines ranked by how much trouble they are in, for the
   * dashboard widget.
   *
   * Separate from {@link BudgetService.getMonth} even though it could be
   * derived from it: the widget wants a handful of rows and the page wants
   * every line, and a dashboard tile should not pay for the page's work.
   *
   * @param userId - The signed-in user.
   * @param timezone - The user's IANA zone, used to decide which month is current.
   * @returns The ranked lines, or an unplanned marker when the month has no lines.
   */
  getAtRisk(userId: string, timezone: string): Promise<AtRiskReport> {
    const today = todayIn(timezone, this.now())
    const monthKey = monthKeyOf(today)
    return this.uow.run(userId, (repos) => this.rankMonth(repos, monthKey, today))
  }

  /**
   * Builds the at-risk report for one month inside an open unit of work.
   *
   * @param repos - Repositories bound to the caller's transaction.
   * @param monthKey - The month to rank, `YYYY-MM`.
   * @param today - Today's date, `YYYY-MM-DD`.
   * @returns The report.
   */
  private async rankMonth(repos: BudgetRepositories, monthKey: string, today: string): Promise<AtRiskReport> {
    const nameOf = categoryNames(await repos.categories.list())
    const lines = await repos.lines.listForMonth(monthKey)
    const windows = await windowLines(repos, monthKey, today, nameOf)
    const accounts = await accountMonthLines(repos, monthKey, today, false)
    if (lines.length === 0 && windows.lines.length === 0 && accounts.lines.length === 0) {
      return { monthKey, today, planned: false, lines: [] }
    }

    const spend = await repos.spend.byCategory(monthKey)
    const carried = await openingBalances(
      repos.balances,
      monthKey,
      lines.filter((l) => l.rollover).map((l) => l.category_id),
      spend,
    )

    const categoryStatuses: LineStatus[] = [
      ...lines.map((line) =>
        lineStatusOf(
          {
            categoryId: line.category_id,
            categoryName: nameOf(line.category_id),
            planned: line.planned,
            carriedIn: carried.get(line.category_id) ?? ZERO_MONEY,
            spent: spend.get(line.category_id) ?? ZERO_MONEY,
            rollover: line.rollover,
          },
          monthKey,
          today,
        ),
      ),
      // A dashboard tile shows one window as the whole pot ("630 of 1,500"),
      // matching its bar, rather than this month's slice of it. It gets the
      // shared shape only, without the page's extra fields.
      ...windows.lines.map((l): LineStatus => ({
        categoryId: l.categoryId, categoryName: l.categoryName,
        planned: l.window?.funded ?? l.planned, available: l.window?.funded ?? l.available,
        spent: l.window?.spentToDate ?? l.spent, remaining: l.remaining, rollover: l.rollover,
        used: l.used, pace: l.pace, elapsed: l.elapsed, health: l.health,
      })),
    ]
    // Account allowances join the tiles and the ranking, but not the totals
    // below: their spending is also spent in categories, and counting it in
    // both would make "spent of available" larger than the month.
    const statuses: LineStatus[] = [...categoryStatuses, ...accounts.lines]

    return {
      monthKey,
      today,
      planned: true,
      total: statuses.length,
      // Ranking is delegated to the shared module so this widget and the month
      // page agree on what "in trouble" means.
      lines: rankAtRisk(statuses),
      breakdown: rankBreakdown(statuses),
      summary: {
        spent: sumMoney(categoryStatuses.map((s) => s.spent)),
        available: sumMoney(categoryStatuses.map((s) => s.available)),
      },
    }
  }
}

/**
 * Turns the database's overlap refusal into a `409` the user can act on.
 *
 * @param write - The repository write.
 * @param message - What to tell the user when it overlaps.
 * @returns Whatever the write returned.
 * @throws {BudgetError} `409 overlaps` on an exclusion violation; anything else is rethrown.
 */
async function refuseOverlap<T>(write: Promise<T>, message: string): Promise<T> {
  try {
    return await write
  } catch (error) {
    if (isOverlapError(error)) throw new BudgetError(message, 409, 'overlaps')
    throw error
  }
}

/**
 * The month's spend with each window's share taken out, so what is left is
 * spending no line covers.
 *
 * @param spend - Category id to the month's net spend.
 * @param windowed - Category id to what that category's windows spent this month.
 * @returns A new map. Categories whose spend is fully inside a window drop out.
 */
function outsideWindows(
  spend: ReadonlyMap<string, string>,
  windowed: ReadonlyMap<string, string>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [categoryId, amount] of spend) {
    const inside = windowed.get(categoryId)
    const rest = inside === undefined ? amount : subtractMoney(amount, inside)
    if (compareMoney(rest, ZERO_MONEY) !== 0) out.set(categoryId, rest)
  }
  return out
}
