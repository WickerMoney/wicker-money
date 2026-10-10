import { addMoney, subtractMoney, ZERO_MONEY } from '@wickermoney/plugin-sdk/money'
import { addDays } from '@wickermoney/plugin-sdk/date'
import {
  asOfInMonth, monthPeriod, statusAt, windowElapsed, windowMonth,
} from '../../shared/index.js'
import type { BudgetRepositories } from '../repository/BudgetRepositories.js'
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
 * Each window costs one spend query, over the window's own start through the
 * end of this month (or the window's end, if that comes first). Clipping to
 * the window's start matters when it begins mid-month, since the month bucket
 * would otherwise include the days before it. A month rarely has more than one
 * or two windows, so one query per window is the simple choice. It is not
 * worth folding them into one.
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
  const { end: monthEnd } = monthPeriod(monthKey)
  const asOf = asOfInMonth(monthKey, today)

  const lines: MonthLine[] = []
  const spentInMonth = new Map<string, string>()

  for (const w of windows) {
    const until = w.period_end < monthEnd ? w.period_end : monthEnd
    const byMonth = await repos.spend.byCategoryAndMonth(w.period_start, until)

    let spentBefore = ZERO_MONEY
    let spentNow = ZERO_MONEY
    const prefix = `${w.category_id}:`
    for (const [key, amount] of byMonth) {
      if (!key.startsWith(prefix)) continue
      const month = key.slice(prefix.length)
      if (month < monthKey) spentBefore = addMoney(spentBefore, amount)
      else if (month === monthKey) spentNow = addMoney(spentNow, amount)
    }

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
