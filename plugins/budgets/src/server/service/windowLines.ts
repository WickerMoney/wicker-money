import { addMoney, subtractMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import { addDays } from '@wickermoney/plugin-sdk/date'
import {
  asOfInMonth, monthPeriod, statusAt, windowElapsed, windowMonth,
} from '../../shared/index.js'
import type { BudgetRepositories } from '../repository/BudgetRepositories.js'
import type { CategoryRange } from '../repository/CategoryRange.js'
import type { MonthLine } from './MonthLine.js'

/** What {@link windowLines} found for one month. */
export interface WindowLines {
  /** One line per window overlapping the month. */
  readonly lines: MonthLine[]
  /**
   * Category id to what that category's windows spent inside this month. The
   * caller subtracts it from the month's spend before looking for unbudgeted
   * spending, so a gift bought on December 28, after a window that ended on
   * the 25th, still shows up as unbudgeted.
   */
  readonly spentInMonth: Map<string, string>
}

/**
 * Builds the month's lines for every window that overlaps it.
 *
 * Every window's spend comes from one query, however many windows there are.
 * Each window asks for two ranges of its own category: from its start up to
 * this month (what it spent before), and from its start or the month's first
 * day, whichever is later, through the end of this month or of the window,
 * whichever is sooner (what it spent in the month). Clipping to the window's
 * own start and end matters when it begins or ends mid-month, since a
 * month-sized bucket would include days outside it.
 *
 * @param repos - Repositories bound to the caller's transaction.
 * @param monthKey - The month being shown, `YYYY-MM`.
 * @param today - Today's date in the user's zone, `YYYY-MM-DD`.
 * @param nameOf - Resolves a category id to its display name.
 * @returns The window lines and their in-month spend by category.
 */
export async function windowLines(
  repos: BudgetRepositories,
  monthKey: string,
  today: string,
  nameOf: (categoryId: string) => string,
): Promise<WindowLines> {
  const windows = await repos.lines.listWindows(monthKey)
  const { start: monthStart, end: monthEnd } = monthPeriod(monthKey)
  const asOf = asOfInMonth(monthKey, today)

  const ranges: CategoryRange[] = []
  for (const w of windows) {
    const until = w.period_end < monthEnd ? w.period_end : monthEnd
    // A range is left out when it is empty: a window that starts inside the
    // month has no "before", and one that ends before the month's first day
    // has no "now".
    const beforeEnd = until < monthStart ? until : monthStart
    if (w.period_start < beforeEnd) {
      ranges.push({ key: `${w.id}:before`, categoryId: w.category_id, start: w.period_start, end: beforeEnd })
    }
    const nowStart = w.period_start > monthStart ? w.period_start : monthStart
    if (nowStart < until) ranges.push({ key: `${w.id}:now`, categoryId: w.category_id, start: nowStart, end: until })
  }
  const spent = await repos.spend.byCategoryRanges(ranges)

  const lines: MonthLine[] = []
  const spentInMonth = new Map<string, string>()

  for (const w of windows) {
    // Through addMoney so a total is always written the same way, as before
    // when the months were added up here.
    const spentBefore = addMoney(ZERO_MONEY, spent.get(`${w.id}:before`) ?? ZERO_MONEY)
    const spentNow = addMoney(ZERO_MONEY, spent.get(`${w.id}:now`) ?? ZERO_MONEY)

    const figures = windowMonth({
      start: w.period_start, funded: w.planned, monthKey, spentBefore, spentInMonth: spentNow,
    })

    // Pace over the whole window: the pot against the time it has to last.
    // Pace is reported for the bar but does not set health, since a window's
    // spending is lumpy by design; only running the pot dry does (see statusAt).
    const status = statusAt(
      {
        categoryId: w.category_id,
        categoryName: nameOf(w.category_id),
        planned: w.planned,
        available: w.planned,
        spent: figures.spentToDate,
        remaining: subtractMoney(w.planned, figures.spentToDate),
        rollover: false,
      },
      windowElapsed(w.period_start, w.period_end, asOf),
      { judgePace: false },
    )

    lines.push({
      ...status,
      // The month's own figures for the table and the totals.
      planned: figures.planned,
      available: figures.available,
      spent: figures.spent,
      remaining: figures.remaining,
      carriedIn: figures.carriedIn,
      id: w.id,
      note: w.note,
      draft: false,
      window: {
        start: w.period_start,
        through: addDays(w.period_end, -1),
        funded: w.planned,
        spentToDate: figures.spentToDate,
      },
    })
    spentInMonth.set(w.category_id, addMoney(spentInMonth.get(w.category_id) ?? ZERO_MONEY, spentNow))
  }

  return { lines, spentInMonth }
}
