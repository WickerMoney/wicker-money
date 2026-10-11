import type { ParsedDebt } from './ParsedDebt.js'
import type { Strategy } from './Strategy.js'

/**
 * Puts debts in the order extra money is aimed at them.
 *
 * - `snowball`: smallest starting balance first. A tie goes to the higher rate,
 *   which costs less interest and loses nothing the person was promised.
 * - `avalanche`: highest rate first. A tie goes to the smaller balance, which
 *   is the sooner win at no extra cost.
 *
 * Any remaining tie keeps the caller's order, so the same input always gives
 * the same plan.
 *
 * The order is fixed at the start and not re-evaluated as balances change.
 * Rates do not change, and the debt being paid is the one getting smaller, so
 * for the usual inputs the two would agree; a fixed order is also the one a
 * person can read off a list and predict.
 *
 * @param debts - Debts with a balance.
 * @param strategy - The strategy to order for.
 * @returns A new array; the input is not modified.
 */
export function priorityOrder(debts: readonly ParsedDebt[], strategy: Strategy): ParsedDebt[] {
  const byBalance = (a: ParsedDebt, b: ParsedDebt): number => compare(a.balance, b.balance)
  const byRate = (a: ParsedDebt, b: ParsedDebt): number => compare(b.apr, a.apr)
  const byPosition = (a: ParsedDebt, b: ParsedDebt): number => a.position - b.position
  const rules =
    strategy === 'snowball' ? [byBalance, byRate, byPosition] : [byRate, byBalance, byPosition]
  return [...debts].sort((a, b) => {
    for (const rule of rules) {
      const result = rule(a, b)
      if (result !== 0) return result
    }
    return 0
  })
}

/** Three-way comparison of two `bigint`s, which `Array.sort` needs as a `number`. */
function compare(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0
}
