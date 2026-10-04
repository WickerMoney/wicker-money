import { ValidationError } from '../../errors.js'
import { money } from '../../money.js'

/**
 * Checks that a new amount for one leg of a transfer keeps that leg's
 * direction.
 *
 * The leg leaving an account is negative and the leg arriving is positive.
 * Editing a leg to the opposite sign would silently reverse the whole transfer
 * (the sibling is set to the negated amount) while both legs still name the
 * same accounts, so the sign is what the accounts say it is and cannot change.
 *
 * @param currentAmount - The leg's stored amount.
 * @param nextAmount - The requested amount.
 * @throws {ValidationError} If the new amount is zero or has the opposite sign.
 */
export function assertTransferAmountKeepsDirection(currentAmount: string, nextAmount: string): void {
  const next = money(nextAmount)
  if (next.isZero() || next.isNegative() !== money(currentAmount).isNegative()) {
    const message = 'A transfer leg keeps its direction: the amount must stay non-zero and keep its sign. ' +
      'To reverse a transfer, delete it and record a new one.'
    throw new ValidationError(message, [{ path: ['amount'], message }])
  }
}
