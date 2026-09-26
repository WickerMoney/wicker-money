import { ValidationError } from '../../errors.js'
import type { TransactionPatch } from './TransactionPatch.js'

/**
 * Refuses an edit that names a transfer account.
 *
 * Turning an ordinary transaction into a transfer by editing one field would
 * leave the other leg unwritten, and a half-written transfer is money that left
 * one account and arrived nowhere.
 *
 * @param patch - The requested edit.
 * @throws {ValidationError} If the patch names a transfer account, even `null`.
 */
export function assertTransferFlagUntouched(patch: TransactionPatch): void {
  if (patch.transferAccountId !== undefined) {
    throw new ValidationError(
      'Whether something is a transfer cannot be edited. Delete it and record ' +
        'a transfer instead.',
    )
  }
}
