import type { PayoffPlan } from '../../shared/index.js'
import type { ChartModel, MonthReadout } from '../models/index.js'

/**
 * What to say about one point on the chart.
 *
 * Amounts that are shown come from the plan's exact strings. The chart's
 * numbers are only used to decide which debts still have a balance.
 *
 * @param plan - The plan.
 * @param model - The model built from it.
 * @param index - 0 for today, then 1 for the first payment date.
 * @param formatMoney - The host's money formatter.
 */
export function readMonth(
  plan: PayoffPlan, model: ChartModel, index: number, formatMoney: (value: string) => string,
): MonthReadout {
  const month = index === 0 ? undefined : plan.schedule[index - 1]
  const total = month?.balance ?? plan.startingBalance
  const names = new Map(plan.debts.map((d) => [d.id, d.name] as const))
  const exact = new Map(month?.debts.map((d) => [d.debtId, d.balance] as const) ?? [])
  const rows = [...model.bands]
    .reverse()
    .map((band) => {
      const owed = band.values[index] ?? 0
      return { band, owed }
    })
    .filter(({ owed }) => owed > 0)
    .map(({ band, owed }) => ({
      name: band.name,
      color: band.color,
      balance: formatMoney(
        index === 0 || band.id === 'other'
          ? owed.toFixed(4)
          : (exact.get(band.id) ?? plan.debts.find((d) => d.id === band.id)?.startingBalance ?? owed.toFixed(4)),
      ),
    }))
  return {
    index,
    date: model.dates[index] ?? plan.startDate,
    total: formatMoney(total),
    paid: month === undefined ? null : formatMoney(month.payment),
    interest: month === undefined ? null : formatMoney(month.interest),
    rows,
    clearedNames: plan.debts.filter((d) => d.payoffMonth === index && index > 0).map((d) => names.get(d.id) ?? d.name),
  }
}
