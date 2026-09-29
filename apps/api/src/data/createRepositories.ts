import type { Trx } from '../db/Trx.js'
import { KyselyAccountRepository } from '../accounts/repository/KyselyAccountRepository.js'
import { KyselyCategoryRepository } from '../categories/repository/KyselyCategoryRepository.js'
import { KyselyCategoryRuleRepository } from '../categories/repository/KyselyCategoryRuleRepository.js'
import { KyselyExportRepository } from '../settings/repository/KyselyExportRepository.js'
import { KyselyOnboardingRepository } from '../onboarding/repository/KyselyOnboardingRepository.js'
import { KyselyPluginRegistryRepository } from '../plugins/repository/KyselyPluginRegistryRepository.js'
import { KyselyReportRepository } from '../core/repository/KyselyReportRepository.js'
import { KyselyRecurringItemRepository } from '../recurring/repository/KyselyRecurringItemRepository.js'
import { KyselySessionRepository } from '../auth/repository/KyselySessionRepository.js'
import { KyselySplitRepository } from '../transactions/repository/KyselySplitRepository.js'
import { KyselyTransactionRepository } from '../transactions/repository/KyselyTransactionRepository.js'
import { KyselyUsageRepository } from '../db/repository/KyselyUsageRepository.js'
import { KyselyUserRepository } from '../auth/repository/KyselyUserRepository.js'
import type { Repositories } from './Repositories.js'

/**
 * Builds the Kysely-backed repositories for one transaction.
 *
 * @param trx - A transaction already bound to a user (or to the system).
 * @returns Every repository, all sharing `trx`.
 */
export function createRepositories(trx: Trx): Repositories {
  return {
    accounts: new KyselyAccountRepository(trx),
    transactions: new KyselyTransactionRepository(trx),
    splits: new KyselySplitRepository(trx),
    categories: new KyselyCategoryRepository(trx),
    categoryRules: new KyselyCategoryRuleRepository(trx),
    users: new KyselyUserRepository(trx),
    sessions: new KyselySessionRepository(trx),
    usage: new KyselyUsageRepository(trx),
    onboarding: new KyselyOnboardingRepository(trx),
    pluginRegistry: new KyselyPluginRegistryRepository(trx),
    reports: new KyselyReportRepository(trx),
    exports: new KyselyExportRepository(trx),
    recurringItems: new KyselyRecurringItemRepository(trx),
  }
}
