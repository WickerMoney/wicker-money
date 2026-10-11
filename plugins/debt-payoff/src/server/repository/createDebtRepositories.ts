import type { Query } from '@wickermoney/plugin-sdk/server'
import type { DebtRepositories } from './DebtRepositories.js'
import { QueryAccountRepository } from './QueryAccountRepository.js'
import { QueryDebtRepository } from './QueryDebtRepository.js'
import { QuerySettingsRepository } from './QuerySettingsRepository.js'

/**
 * Builds the `Query`-backed repositories over one user-bound query runner.
 *
 * @param q - A query runner already bound to the current user.
 * @returns A fresh set of repositories sharing that runner, and so its transaction.
 */
export function createDebtRepositories(q: Query): DebtRepositories {
  return {
    debts: new QueryDebtRepository(q),
    settings: new QuerySettingsRepository(q),
    accounts: new QueryAccountRepository(q),
  }
}
