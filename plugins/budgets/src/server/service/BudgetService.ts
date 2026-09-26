import {
  draftPlannedFrom, monthKeyOf, monthPeriod, previousMonth, rankAtRisk, sumMoney, todayIn,
} from '../../shared/index.js'
import type { BudgetRepositories } from '../repository/BudgetRepositories.js'
import type { BudgetUnitOfWork } from '../repository/BudgetUnitOfWork.js'
import type { AdoptResult } from './AdoptResult.js'
import type { AtRiskReport } from './AtRiskReport.js'
import { BudgetError } from './BudgetError.js'
import { categoryNames } from './categoryNames.js'
import type { Clock } from './Clock.js'
import type { DeleteResult } from './DeleteResult.js'
import { findUnbudgeted } from './findUnbudgeted.js'
import type { LineInput } from './LineInput.js'
import { lineStatusOf } from './lineStatusOf.js'
import type { MonthLine } from './MonthLine.js'
import type { MonthReport } from './MonthReport.js'
import { openingBalances } from './openingBalances.js'
import type { SavedLine } from './SavedLine.js'
import { summarizeMonth } from './summarizeMonth.js'
import { ZERO_MONEY } from './ZERO_MONEY.js'

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

      const own = await repos.lines.listForMonth(monthKey)
      const draft = own.length === 0
      const source = draft ? await repos.lines.listForMonth(previousMonth(monthKey)) : own

      const spend = await repos.spend.byCategory(monthKey)

      // A draft has not happened yet, so it carries nothing in: the balance it
      // would inherit depends on how the current month actually ends.
      const carried = draft
        ? new Map<string, string>()
        : await openingBalances(
            repos.balances,
            monthKey,
            source.filter((l) => l.rollover).map((l) => l.category_id),
          )

      const today = todayIn(timezone, this.now())

      const lines: MonthLine[] = source.map((line) => {
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
        return { ...status, id: draft ? null : line.id, carriedIn, note: line.note, draft }
      })

      const unbudgeted = findUnbudgeted(spend, new Set(lines.map((l) => l.categoryId)), nameOf)

      return {
        monthKey,
        period: monthPeriod(monthKey),
        today,
        draft,
        lines,
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
      const row = await repos.lines.upsert({
        categoryId: input.categoryId,
        periodStart: start,
        periodEnd: end,
        planned: input.planned,
        rollover: input.rollover,
        note: input.note,
      })
      if (row === undefined) throw new BudgetError('The line was not saved.', 500, 'not_saved')
      return { id: row.id, categoryId: row.category_id, planned: row.planned, rollover: row.rollover }
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
      const existing = await repos.lines.listForMonth(monthKey)
      if (existing.length > 0) return { created: 0, alreadyPlanned: existing.length }

      const source = await repos.lines.listForMonth(previous)
      if (source.length === 0) {
        throw new BudgetError(
          `There is nothing to copy — ${previous} has no budget either.`,
          409,
          'nothing_to_copy',
        )
      }
      return { created: await repos.lines.copyMonth(previous, monthKey), alreadyPlanned: 0 }
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
    const lines = await repos.lines.listForMonth(monthKey)
    if (lines.length === 0) return { monthKey, today, planned: false, lines: [] }

    const nameOf = categoryNames(await repos.categories.list())
    const spend = await repos.spend.byCategory(monthKey)
    const carried = await openingBalances(
      repos.balances,
      monthKey,
      lines.filter((l) => l.rollover).map((l) => l.category_id),
    )

    const statuses = lines.map((line) =>
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
    )

    return {
      monthKey,
      today,
      planned: true,
      total: statuses.length,
      // Ranking is delegated to the shared module so this widget and the month
      // page agree on what "in trouble" means.
      lines: rankAtRisk(statuses),
      summary: {
        spent: sumMoney(statuses.map((s) => s.spent)),
        available: sumMoney(statuses.map((s) => s.available)),
      },
    }
  }
}
