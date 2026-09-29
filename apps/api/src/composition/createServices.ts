import type { UnitOfWork } from '../data/UnitOfWork.js'
import { AuthService } from '../auth/service.js'
import type { Config } from '../config.js'
import type { Services } from './Services.js'
import type { Db } from '../db/client.js'
import { AccountService } from '../accounts/service/AccountService.js'
import { CategoryRuleService } from '../categories/service/CategoryRuleService.js'
import { CategoryService } from '../categories/service/CategoryService.js'
import { OnboardingService } from '../onboarding/service/OnboardingService.js'
import { PluginService } from '../plugins/service/PluginService.js'
import { ReportService } from '../core/service/ReportService.js'
import { RecurringItemService } from '../recurring/service/RecurringItemService.js'
import { SettingsService } from '../settings/service/SettingsService.js'
import { TransactionService } from '../transactions/service/TransactionService.js'


/**
 * The composition root: wires services to a unit of work.
 *
 * @param db - Database handle, still needed by the few pieces that manage their own connections.
 * @param uow - Transaction boundary shared by all services.
 * @param config - Validated configuration.
 * @returns The service registry.
 */
export function createServices(db: Db, uow: UnitOfWork, config: Config): Services {
  const plugins = new PluginService(uow, { remoteOrigins: config.PLUGIN_REMOTE_ORIGINS })
  return {
    auth: new AuthService(uow, config),
    accounts: new AccountService(uow),
    transactions: new TransactionService(uow),
    categories: new CategoryService(uow),
    categoryRules: new CategoryRuleService(uow),
    onboarding: new OnboardingService(uow),
    settings: new SettingsService(uow, { config, plugins }),
    plugins,
    reports: new ReportService(uow),
    recurringItems: new RecurringItemService(uow),
  }
}
