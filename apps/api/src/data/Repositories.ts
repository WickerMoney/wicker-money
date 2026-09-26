import type { AccountRepository } from '../accounts/repository/AccountRepository.js'
import type { SessionRepository } from '../auth/repository/SessionRepository.js'
import type { UserRepository } from '../auth/repository/UserRepository.js'
import type { CategoryRepository } from '../categories/repository/CategoryRepository.js'
import type { CategoryRuleRepository } from '../categories/repository/CategoryRuleRepository.js'
import type { ReportRepository } from '../core/repository/ReportRepository.js'
import type { UsageRepository } from '../db/repository/UsageRepository.js'
import type { OnboardingRepository } from '../onboarding/repository/OnboardingRepository.js'
import type { PluginRegistryRepository } from '../plugins/repository/PluginRegistryRepository.js'
import type { ExportRepository } from '../settings/repository/ExportRepository.js'
import type { SplitRepository } from '../transactions/repository/SplitRepository.js'
import type { TransactionRepository } from '../transactions/repository/TransactionRepository.js'

/**
 * Every repository, bound to a single database transaction.
 *
 * A repository is the only place SQL is written. Services obtain this object
 * from a {@link UnitOfWork}; all repositories in one instance share the same
 * transaction, so a service can update several aggregates atomically and
 * row-level security sees a single user for all of them.
 */
export interface Repositories {
  /** Bank, card and cash accounts, with computed balances. */
  readonly accounts: AccountRepository
  /** Ledger transactions, including transfers. */
  readonly transactions: TransactionRepository
  /** Transaction splits. */
  readonly splits: SplitRepository
  /** The category tree. */
  readonly categories: CategoryRepository
  /** Auto-categorization rules and their conditions. */
  readonly categoryRules: CategoryRuleRepository
  /** User identities. */
  readonly users: UserRepository
  /** Refresh-token sessions. */
  readonly sessions: SessionRepository
  /** Discovery of rows that reference a parent row, across schemas. */
  readonly usage: UsageRepository
  /** Setup-wizard state. */
  readonly onboarding: OnboardingRepository
  /** Installed and enabled plugins. */
  readonly pluginRegistry: PluginRegistryRepository
  /** Read-side aggregations used by dashboards and plugins (summaries, pickers). */
  readonly reports: ReportRepository
  /** Whole-account data reads for export. */
  readonly exports: ExportRepository
}
