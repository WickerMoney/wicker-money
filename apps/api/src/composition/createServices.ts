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
import type { PluginServiceOptions } from '../plugins/service/PluginServiceOptions.js'
import { ReportService } from '../core/service/ReportService.js'
import { RecurringItemService } from '../recurring/service/RecurringItemService.js'
import { RecurringOccurrenceService } from '../recurring/service/RecurringOccurrenceService.js'
import { EraseService } from '../settings/service/EraseService.js'
import { ExportTicketService } from '../settings/service/ExportTicketService.js'
import { SettingsService } from '../settings/service/SettingsService.js'
import { TransactionService } from '../transactions/service/TransactionService.js'
import { UserAdminService } from '../users/service/UserAdminService.js'


/**
 * The composition root: wires services to a unit of work.
 *
 * @param db - Database handle, still needed by the few pieces that manage their own connections.
 * @param uow - Transaction boundary shared by all services.
 * @param config - Validated configuration.
 * @param pluginOptions - Overrides for the plugin service; only tests and the browser check pass any.
 * @returns The service registry.
 */
export function createServices(
  db: Db, uow: UnitOfWork, config: Config, pluginOptions: Pick<PluginServiceOptions, 'bundled' | 'external'> = {},
): Services {
  const plugins = new PluginService(uow, { ...pluginOptions, remoteOrigins: config.PLUGIN_REMOTE_ORIGINS })
  const auth = new AuthService(uow, config)
  return {
    auth,
    users: new UserAdminService(uow),
    accounts: new AccountService(uow),
    transactions: new TransactionService(uow),
    categories: new CategoryService(uow),
    categoryRules: new CategoryRuleService(uow),
    onboarding: new OnboardingService(uow),
    settings: new SettingsService(uow, { config, plugins }),
    erase: new EraseService(uow, { auth, config }),
    exportTickets: new ExportTicketService({ auth }),
    plugins,
    reports: new ReportService(uow),
    recurringItems: new RecurringItemService(uow),
    recurringOccurrences: new RecurringOccurrenceService(uow),
  }
}
