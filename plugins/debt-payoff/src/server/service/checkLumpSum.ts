import { moneyToUnits } from '@wickermoney/plugin-sdk/money'
import { DebtPayoffError } from './DebtPayoffError.js'
import type { LumpSumFields } from './LumpSumFields.js'

/**
 * Checks what only the service can: the parts of a lump sum name each debt
 * once, name only the person's own debts, and do not add up to more than the
 * lump sum. (The shape of the amounts and dates is the route schema's job.)
 *
 * Each problem is raised on the part it belongs to, so the form can show it in
 * place.
 *
 * @param fields - The lump sum as sent.
 * @param ownDebtIds - The ids of every debt the person has, archived included.
 * @throws {DebtPayoffError} `400` on `allocations`: `unknown_debt` for a debt
 *   that is not the person's (which includes another person's, answered the
 *   same as one that does not exist), `duplicate_debt`, `allocation_too_large`.
 */
export function checkLumpSum(fields: LumpSumFields, ownDebtIds: ReadonlySet<string>): void {
  const seen = new Set<string>()
  let total = 0n
  for (const [index, part] of (fields.allocations ?? []).entries()) {
    if (!ownDebtIds.has(part.debtId)) {
      throw problem(index, 'debtId', 'Choose one of your own debts.', 'unknown_debt')
    }
    if (seen.has(part.debtId)) {
      throw problem(index, 'debtId', 'Name each debt once.', 'duplicate_debt')
    }
    seen.add(part.debtId)
    total += moneyToUnits(part.amount)
  }
  if (total > moneyToUnits(fields.amount)) {
    throw new DebtPayoffError(
      'allocations: The amounts for single debts add up to more than the lump sum.',
      400,
      'allocation_too_large',
      [{ path: ['allocations'], message: 'The amounts for single debts add up to more than the lump sum.' }],
    )
  }
}

function problem(index: number, field: string, message: string, code: string): DebtPayoffError {
  return new DebtPayoffError(`allocations.${index}.${field}: ${message}`, 400, code, [{ path: ['allocations', index, field], message }])
}
