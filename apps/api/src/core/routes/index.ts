import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerGetAccountsSummary } from './handlers/getAccountsSummary.js'
import { registerGetMonthlySummary } from './handlers/getMonthlySummary.js'
import { registerListAccounts } from './handlers/listAccounts.js'
import { registerListCategoryPicker } from './handlers/listCategoryPicker.js'
import { requireTableGrant } from './helpers/requireTableGrant.js'

/**
 * Registers the read endpoints plugins may call under `/api/v1/core`, each
 * gated on a manifest grant.
 *
 * These are aggregates rather than raw table dumps: a plugin that needs a chart
 * should not have to pull every transaction to draw it, and the narrower the
 * surface the less a grant actually hands over.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerCoreDataRoutes(app: FastifyInstance, { plugins, reports }: Services): void {
  const needTransactions = requireTableGrant(app, plugins, 'transactions')
  const needAccounts = requireTableGrant(app, plugins, 'accounts')
  const needCategories = requireTableGrant(app, plugins, 'categories')

  registerGetMonthlySummary(app, reports, needTransactions)
  registerListAccounts(app, reports, needAccounts)
  registerListCategoryPicker(app, reports, needCategories)
  registerGetAccountsSummary(app, reports, needAccounts)
}
