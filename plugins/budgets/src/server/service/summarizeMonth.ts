import { sumMoney } from '../../shared/index.js'
import type { MonthLine } from './MonthLine.js'
import type { MonthTotals } from './MonthTotals.js'
import type { UnbudgetedSpend } from './UnbudgetedSpend.js'

/**
 * Totals a month's lines and counts the ones in trouble.
 *
 * @param lines - The month's lines with their derived figures.
 * @param unbudgeted - Categories with spending and no line.
 * @returns Exact money totals plus the over and at-risk counts.
 */
export function summarizeMonth(
  lines: readonly MonthLine[],
  unbudgeted: readonly UnbudgetedSpend[],
): MonthTotals {
  return {
    planned: sumMoney(lines.map((l) => l.planned)),
    available: sumMoney(lines.map((l) => l.available)),
    spent: sumMoney(lines.map((l) => l.spent)),
    remaining: sumMoney(lines.map((l) => l.remaining)),
    unbudgetedSpent: sumMoney(unbudgeted.map((u) => u.spent)),
    overCount: lines.filter((l) => l.health === 'over').length,
    atRiskCount: lines.filter((l) => l.health === 'at-risk').length,
  }
}
