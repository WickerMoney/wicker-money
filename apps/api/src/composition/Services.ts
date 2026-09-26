import type { AuthService } from '../auth/service.js'
import type { AccountService } from '../accounts/service/AccountService.js'
import type { CategoryRuleService } from '../categories/service/CategoryRuleService.js'
import type { CategoryService } from '../categories/service/CategoryService.js'
import type { OnboardingService } from '../onboarding/service/OnboardingService.js'
import type { PluginService } from '../plugins/service/PluginService.js'
import type { ReportService } from '../core/service/ReportService.js'
import type { SettingsService } from '../settings/service/SettingsService.js'
import type { TransactionService } from '../transactions/service/TransactionService.js'

/** Every application service, constructed once at startup and shared by all requests. */
export interface Services {
  /** Registration, login, token issue and rotation. */
  readonly auth: AuthService
  /** Account rules: balances, opening-balance fixes, deletion and history migration. */
  readonly accounts: AccountService
  /** Ledger rules: creating, editing, splitting, transferring and categorizing transactions. */
  readonly transactions: TransactionService
  /** Category tree rules. */
  readonly categories: CategoryService
  /** Auto-categorization rules. */
  readonly categoryRules: CategoryRuleService
  /** Setup wizard: previews and applies the starter category set. */
  readonly onboarding: OnboardingService
  /** Instance configuration report and whole-account data export. */
  readonly settings: SettingsService
  /** Plugin registry queries. */
  readonly plugins: PluginService
  /** Read-side aggregations for dashboards and plugins. */
  readonly reports: ReportService
}
