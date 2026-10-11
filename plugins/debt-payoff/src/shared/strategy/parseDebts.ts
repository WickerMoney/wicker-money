import { moneyToUnits } from '@wickermoney/plugin-sdk/money'
import type { DebtInput } from './DebtInput.js'
import { MAX_APR_UNITS } from './MAX_APR_UNITS.js'
import { MAX_MONEY_UNITS } from './MAX_MONEY_UNITS.js'
import type { ParsedDebt } from './ParsedDebt.js'

/**
 * Validates debts and converts their amounts to exact integers.
 *
 * Strict by design, like the SDK's money module: nothing is rounded or
 * clamped, because a plan built on a quietly adjusted input answers a
 * different question from the one asked.
 *
 * @param debts - The debts, in the order the person keeps them.
 * @returns The same debts with amounts as `bigint` units, in the same order.
 * @throws {RangeError} For a duplicate or empty id, an amount that is not a
 *   plain decimal with at most four places, a negative amount, an amount larger
 *   than `numeric(19,4)` holds, or an APR above 999.9999.
 */
export function parseDebts(debts: readonly DebtInput[]): ParsedDebt[] {
  const seen = new Set<string>()
  return debts.map((debt, position) => {
    if (typeof debt.id !== 'string' || debt.id === '') throw new RangeError('A debt needs an id.')
    if (seen.has(debt.id)) throw new RangeError(`Duplicate debt id: ${debt.id}`)
    seen.add(debt.id)
    return {
      id: debt.id,
      name: debt.name,
      balance: amount(debt.balance, 'balance'),
      apr: rate(debt.apr),
      minimum: amount(debt.minimumPayment, 'minimum payment'),
      position,
    }
  })
}

/** Parses a money amount that must be between zero and what the column holds. */
export function amount(value: string, label: string): bigint {
  const units = moneyToUnits(value, label)
  if (units < 0n) throw new RangeError(`The ${label} cannot be negative.`)
  if (units > MAX_MONEY_UNITS) throw new RangeError(`The ${label} is larger than can be stored.`)
  return units
}

/** Parses an APR percentage; the money parser is exact for any decimal with at most four places. */
function rate(value: string): bigint {
  const units = moneyToUnits(value, 'APR')
  if (units < 0n) throw new RangeError('The APR cannot be negative.')
  if (units > MAX_APR_UNITS) throw new RangeError('The APR cannot be more than 999.9999%.')
  return units
}
