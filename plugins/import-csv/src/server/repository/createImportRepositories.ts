import type { ImportRepositories } from './ImportRepositories.js'
import type { Query } from '@wickermoney/plugin-sdk/server'
import { QueryAccountRepository } from './QueryAccountRepository.js'
import { QueryBatchLinkRepository } from './QueryBatchLinkRepository.js'
import { QueryBatchRepository } from './QueryBatchRepository.js'
import { QueryCategoryRuleRepository } from './QueryCategoryRuleRepository.js'
import { QueryImportLockRepository } from './QueryImportLockRepository.js'
import { QueryLedgerRepository } from './QueryLedgerRepository.js'
import { QueryMappingRepository } from './QueryMappingRepository.js'
import type { RuleLoader } from './RuleLoader.js'

/**
 * Builds the `Query`-backed repositories over one user-bound query runner.
 *
 * @param q - A query runner already bound to the current user.
 * @param loadRules - The host's rule loader.
 * @returns A fresh set of repositories sharing that runner, and so its transaction.
 */
export function createImportRepositories(q: Query, loadRules: RuleLoader): ImportRepositories {
  return {
    accounts: new QueryAccountRepository(q),
    locks: new QueryImportLockRepository(q),
    mappings: new QueryMappingRepository(q),
    batches: new QueryBatchRepository(q),
    batchLinks: new QueryBatchLinkRepository(q),
    ledger: new QueryLedgerRepository(q),
    categoryRules: new QueryCategoryRuleRepository(q, loadRules),
  }
}
