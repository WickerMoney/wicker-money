import { NotFoundError, ValidationError } from '../../errors.js'
import type { AccountRepository } from '../repository/AccountRepository.js'
import type { MigrationPair } from './MigrationPair.js'

/**
 * Loads the source and target accounts of a migration and checks they can be merged.
 *
 * @param accounts - The account repository, bound to the current user.
 * @param fromId - The account whose history would be moved.
 * @param toId - The account that would receive it.
 * @returns Both accounts.
 * @throws {NotFoundError} When either account does not exist or is not visible to the user.
 * @throws {ValidationError} When the accounts use different currencies.
 */
export async function loadMigrationPair(
  accounts: AccountRepository,
  fromId: string,
  toId: string,
): Promise<MigrationPair> {
  const found = await accounts.findMigrationAccounts([fromId, toId])
  // Row-level security already confines this to the user's own accounts, so
  // anything missing here belongs to someone else or does not exist.
  const from = found.find((a) => a.id === fromId)
  const to = found.find((a) => a.id === toId)
  if (from === undefined || to === undefined) throw new NotFoundError('Account')
  if (from.currency_code !== to.currency_code) {
    throw new ValidationError(
      `'${from.name}' is ${from.currency_code} and '${to.name}' is ${to.currency_code}. There is no ` +
        'exchange-rate data to convert correctly, so accounts in different currencies cannot be merged.',
    )
  }
  return { from, to }
}
