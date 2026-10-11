import type { PayoffPlan } from '../../shared/index.js'
import type { ChartBand, ChartModel } from '../models/index.js'
import { OTHER_COLOR } from './colorFor.js'

/** The id of the band that gathers the debts without a colour of their own. */
export const OTHER_BAND_ID = 'other'

/**
 * Reshapes a plan for drawing: the balance of every debt at every month.
 *
 * The stack is built so the debt that is paid first sits on top and shrinks
 * away first, which makes the order of the plan visible. Debts without a colour
 * (past the sixth in the person's list) are summed into one grey band at the
 * bottom rather than given a generated hue.
 *
 * Money is converted to numbers here for geometry only; every figure shown as
 * text is read from the plan's own strings.
 *
 * @param plan - The plan from the API.
 * @param colors - Each debt's colour by id; a debt missing from it is folded into "Other".
 * @returns The model, or `null` when nothing is owed.
 */
export function buildChartModel(plan: PayoffPlan, colors: ReadonlyMap<string, string>): ChartModel | null {
  const owing = plan.debts.filter((d) => Number(d.startingBalance) > 0)
  if (owing.length === 0 || plan.schedule.length === 0) return null

  // One lookup per month, so the build is months x debts rather than months x debts squared.
  const balances = plan.schedule.map((m) => new Map(m.debts.map((d) => [d.debtId, Number(d.balance)] as const)))
  const series = (id: string, start: string): number[] => [
    Number(start),
    ...balances.map((m) => m.get(id) ?? 0),
  ]

  const named: ChartBand[] = []
  const folded: number[][] = []
  let foldedCount = 0
  for (const debt of owing) {
    const values = series(debt.id, debt.startingBalance)
    const color = colors.get(debt.id)
    if (color === undefined || color === OTHER_COLOR) {
      folded.push(values)
      foldedCount += 1
    } else {
      named.push({ id: debt.id, name: debt.name, color, values })
    }
  }

  const points = plan.schedule.length + 1
  const bands: ChartBand[] = []
  if (foldedCount > 0) {
    bands.push({
      id: OTHER_BAND_ID,
      name: foldedCount === 1 ? 'Another debt' : `${foldedCount} other debts`,
      color: OTHER_COLOR,
      values: Array.from({ length: points }, (_, i) => folded.reduce((sum, v) => sum + (v[i] ?? 0), 0)),
    })
  }
  // `named` is in payoff order, first paid first; the stack is drawn bottom up.
  bands.push(...named.reverse())

  const totals = Array.from({ length: points }, (_, i) => bands.reduce((sum, b) => sum + (b.values[i] ?? 0), 0))
  return {
    dates: [plan.startDate, ...plan.schedule.map((m) => m.date)],
    bands,
    totals,
    max: Math.max(...totals),
  }
}
