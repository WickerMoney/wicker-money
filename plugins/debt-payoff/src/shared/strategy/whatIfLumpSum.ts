import { moneyToUnits, unitsToMoney } from '@wickermoney/plugin-sdk/money'
import { buildPayoffPlan } from './buildPayoffPlan.js'
import type { DebtInput } from './DebtInput.js'
import type { LumpSumInput } from './LumpSumInput.js'
import type { PayoffPlan } from './PayoffPlan.js'
import type { PlanOptions } from './PlanOptions.js'
import type { WhatIfResult, WhatIfSummary } from './WhatIfResult.js'

/**
 * Compares the current plan with the same plan plus one more lump sum.
 *
 * Pure and read-only: nothing is saved, and the lump sums already in
 * `options` stay in both scenarios, so the difference is the candidate alone.
 * Everything is computed by {@link buildPayoffPlan}, so a what-if can never
 * disagree with the plan the person would get by saving the lump sum.
 *
 * @param debts - The debts in the plan, as for {@link buildPayoffPlan}.
 * @param options - The plan's options, including the lump sums already saved.
 * @param candidate - The lump sum to try. Its id must differ from every saved one.
 * @returns The two scenarios' headlines and the difference.
 * @throws {RangeError} As {@link buildPayoffPlan}, including for an invalid candidate.
 */
export function whatIfLumpSum(
  debts: readonly DebtInput[],
  options: PlanOptions,
  candidate: LumpSumInput,
): WhatIfResult {
  const saved = options.lumpSums ?? []
  const current = buildPayoffPlan(debts, { ...options, lumpSums: saved })
  const proposed = buildPayoffPlan(debts, { ...options, lumpSums: [...saved, candidate] })
  const outcome = proposed.lumpSums?.find((item) => item.id === candidate.id)
  if (outcome === undefined) throw new RangeError('The candidate lump sum is missing from its own plan.')

  const comparable = !current.capped && !proposed.capped
  return {
    current: summaryOf(current),
    withLumpSum: summaryOf(proposed),
    interestSaved: comparable
      ? unitsToMoney(moneyToUnits(current.totalInterest) - moneyToUnits(proposed.totalInterest))
      : null,
    monthsSaved: comparable ? current.months - proposed.months : null,
    lumpSum: outcome,
  }
}

/** The headline of one plan. */
function summaryOf(plan: PayoffPlan): WhatIfSummary {
  return {
    debtFreeDate: plan.debtFreeDate,
    months: plan.months,
    totalInterest: plan.totalInterest,
    capped: plan.capped,
  }
}
