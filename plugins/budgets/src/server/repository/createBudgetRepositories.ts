import type { BudgetRepositories } from './BudgetRepositories.js'
import type { Query } from './Query.js'
import { QueryBalanceRepository } from './QueryBalanceRepository.js'
import { QueryBudgetLineRepository } from './QueryBudgetLineRepository.js'
import { QueryCategoryRepository } from './QueryCategoryRepository.js'
import { QuerySpendRepository } from './QuerySpendRepository.js'

/**
 * Builds the `Query`-backed repositories over one user-bound query runner.
 *
 * @param q - A query runner already bound to the current user.
 * @returns A fresh set of repositories sharing that runner, and so its transaction.
 */
export function createBudgetRepositories(q: Query): BudgetRepositories {
  const spend = new QuerySpendRepository(q)
  return {
    lines: new QueryBudgetLineRepository(q),
    spend,
    balances: new QueryBalanceRepository(q, spend),
    categories: new QueryCategoryRepository(q),
  }
}
