import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerCreateRecurringItem } from './handlers/createRecurringItem.js'
import { registerDeleteRecurringItem } from './handlers/deleteRecurringItem.js'
import { registerEndRecurringItem } from './handlers/endRecurringItem.js'
import { registerGetRecurringItem } from './handlers/getRecurringItem.js'
import { registerListOccurrences } from './handlers/listOccurrences.js'
import { registerListRecurringItems } from './handlers/listRecurringItems.js'
import { registerUpdateRecurringItem } from './handlers/updateRecurringItem.js'

/**
 * Registers every recurring-item endpoint under `/api/v1/recurring-items`.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerRecurringItemRoutes(app: FastifyInstance, { recurringItems }: Services): void {
  registerListRecurringItems(app, recurringItems)
  registerListOccurrences(app, recurringItems)
  registerGetRecurringItem(app, recurringItems)
  registerCreateRecurringItem(app, recurringItems)
  registerUpdateRecurringItem(app, recurringItems)
  registerEndRecurringItem(app, recurringItems)
  registerDeleteRecurringItem(app, recurringItems)
}
