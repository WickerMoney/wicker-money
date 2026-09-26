import { statusFor, subtractMoney, sumMoney, type LineStatus } from '../../shared/index.js'
import type { LineFigures } from './LineFigures.js'

/**
 * Derives one line's available, remaining, pace and health for a given day.
 *
 * @param line - The line's plan, carry-in and spend.
 * @param monthKey - The line's month as `YYYY-MM`.
 * @param today - Today's date, `YYYY-MM-DD`, in the user's zone.
 * @returns The line's computed status.
 */
export function lineStatusOf(line: LineFigures, monthKey: string, today: string): LineStatus {
  const available = sumMoney([line.planned, line.carriedIn])
  return statusFor(
    {
      categoryId: line.categoryId,
      categoryName: line.categoryName,
      planned: line.planned,
      available,
      spent: line.spent,
      remaining: subtractMoney(available, line.spent),
      rollover: line.rollover,
    },
    monthKey,
    today,
  )
}
