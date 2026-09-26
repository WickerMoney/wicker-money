import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerArchiveAccount } from './handlers/archiveAccount.js'
import { registerCreateAccount } from './handlers/createAccount.js'
import { registerDeleteAccount } from './handlers/deleteAccount.js'
import { registerDeleteAccountWithHistory } from './handlers/deleteAccountWithHistory.js'
import { registerGetAccount } from './handlers/getAccount.js'
import { registerGetAccountUsage } from './handlers/getAccountUsage.js'
import { registerListAccounts } from './handlers/listAccounts.js'
import { registerMigrateAccount } from './handlers/migrateAccount.js'
import { registerPreviewAccountMigration } from './handlers/previewAccountMigration.js'
import { registerPreviewInitialBalance } from './handlers/previewInitialBalance.js'
import { registerSetInitialBalance } from './handlers/setInitialBalance.js'
import { registerUpdateAccount } from './handlers/updateAccount.js'

/**
 * Registers every account endpoint under `/api/v1`.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerAccountRoutes(app: FastifyInstance, { accounts }: Services): void {
  registerListAccounts(app, accounts)
  registerGetAccount(app, accounts)
  registerCreateAccount(app, accounts)
  registerUpdateAccount(app, accounts)
  registerArchiveAccount(app, accounts)
  registerGetAccountUsage(app, accounts)
  registerDeleteAccount(app, accounts)
  registerDeleteAccountWithHistory(app, accounts)
  registerPreviewAccountMigration(app, accounts)
  registerMigrateAccount(app, accounts)
  registerPreviewInitialBalance(app, accounts)
  registerSetInitialBalance(app, accounts)
}
