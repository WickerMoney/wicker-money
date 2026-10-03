import { money, toMoney } from '../../money.js'
import type { ForecastBreach, ForecastDay, ForecastStats } from './ForecastView.js'

/**
 * The stat tiles and breach points for one account's projected days.
 *
 * Everything below a line is judged on each day's `low` (outflows before
 * inflows), the same conservative reading "Until payday" uses: rent due on
 * payday is a real dip even if the paycheck lands later that day. Today's
 * actual balance counts as a point too, so an account that is already short
 * shows today as its first breach.
 *
 * @param today - The user's today.
 * @param start - Today's balance.
 * @param buffer - The account's buffer; zero means none.
 * @param cash - Whether overdraft and buffer apply (checking and savings).
 * @param days - The projected days, ascending, starting tomorrow.
 * @returns The stats.
 */
export function forecastStats(
  today: string,
  start: string,
  buffer: string,
  cash: boolean,
  days: readonly ForecastDay[],
): ForecastStats {
  const projected = days.map((d) => ({ date: d.date, balance: d.low }))
  const points = [{ date: today, balance: toMoney(start) }, ...projected]

  let lowest = points[0]!
  for (const p of points) if (money(p.balance).lessThan(lowest.balance)) lowest = p

  const end = days.length === 0 ? toMoney(start) : days[days.length - 1]!.balance
  const below = (line: string) => (p: { balance: string }) => money(p.balance).lessThan(line)
  const first = (line: string): ForecastBreach | null => {
    const hit = points.find(below(line))
    return hit === undefined ? null : { date: hit.date, balance: hit.balance }
  }
  const hasBuffer = money(buffer).greaterThan(0)

  return {
    start: toMoney(start),
    end,
    lowest: { date: lowest.date, balance: lowest.balance },
    daysBelowZero: cash ? projected.filter(below('0')).length : null,
    daysBelowBuffer: cash ? projected.filter(below(buffer)).length : null,
    firstBelowZero: cash ? first('0') : null,
    firstBelowBuffer: cash && hasBuffer ? first(buffer) : null,
  }
}
