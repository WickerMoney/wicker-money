import type { AccountRepository } from '../repository/AccountRepository.js'
import { ImportError } from './ImportError.js'

/**
 * Confirms the target account is one the calling user can see.
 *
 * Checking up front gives the user a "no such account" answer instead of a
 * foreign-key violation, and means no batch row is created for an import that
 * cannot succeed.
 *
 * @param accounts - Account repository bound to the current user.
 * @param accountId - The account id to look up.
 * @throws {ImportError} `404` (`not_found`) when the account is not visible to the user.
 */
export async function requireVisibleAccount(accounts: AccountRepository, accountId: string): Promise<void> {
  if (!(await accounts.isVisible(accountId))) {
    throw new ImportError('No such account.', 404, 'not_found')
  }
}
