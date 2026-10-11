import type { AccountRepository } from './AccountRepository.js'
import type { DebtRepository } from './DebtRepository.js'
import type { SettingsRepository } from './SettingsRepository.js'

/** Every repository the debt payoff service needs, all bound to the same transaction. */
export interface DebtRepositories {
  readonly debts: DebtRepository
  readonly settings: SettingsRepository
  readonly accounts: AccountRepository
}
