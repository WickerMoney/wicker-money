import type { AccountLineRepository } from './AccountLineRepository.js'
import type { AccountRepository } from './AccountRepository.js'
import type { BalanceRepository } from './BalanceRepository.js'
import type { BudgetLineRepository } from './BudgetLineRepository.js'
import type { CategoryRepository } from './CategoryRepository.js'
import type { SpendRepository } from './SpendRepository.js'

/** Every repository the budgets service needs, all bound to the same transaction. */
export interface BudgetRepositories {
  readonly lines: BudgetLineRepository
  readonly accountLines: AccountLineRepository
  readonly accounts: AccountRepository
  readonly spend: SpendRepository
  readonly balances: BalanceRepository
  readonly categories: CategoryRepository
}
