import { ValidationError } from '../../errors.js'
import { addMoney, money } from '../../money.js'
import type { SplitPart } from './SplitPart.js'

/**
 * Checks that a set of parts is a legitimate split of a transaction.
 *
 * Every part must be non-zero and share the parent's sign, and together the
 * parts must add up to the parent exactly. Consumers that read splits in place
 * of the parent (budgets, for one) only reconcile with the ledger if the parts
 * add up; a mix of signs could satisfy the sum while turning half of a
 * purchase into income.
 *
 * @param parentAmount - The parent's signed decimal amount.
 * @param parts - The proposed parts.
 * @throws {ValidationError} If the parent is zero, a part is zero or has the
 * wrong sign, or the parts do not total the parent.
 */
export function assertValidSplits(parentAmount: string, parts: readonly SplitPart[]): void {
  const parent = money(parentAmount)
  if (parent.isZero()) throw new ValidationError('A transaction of zero cannot be split.')

  const wrongSign = parts.some((p) => {
    const amount = money(p.amount)
    return amount.isZero() || amount.isNegative() !== parent.isNegative()
  })
  if (wrongSign) {
    throw new ValidationError(
      `Every part must be non-zero and have the same sign as the transaction (${parentAmount}).`,
    )
  }

  const total = addMoney(...parts.map((p) => p.amount))
  if (!money(total).equals(parent)) {
    throw new ValidationError(`Splits total ${total} but the transaction is ${parentAmount}. They must match.`)
  }
}
