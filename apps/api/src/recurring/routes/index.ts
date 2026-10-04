import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerCreateRecurringItem } from './handlers/createRecurringItem.js'
import { registerDeleteRecurringItem } from './handlers/deleteRecurringItem.js'
import { registerDismissSuggestion } from './handlers/dismissSuggestion.js'
import { registerEndRecurringItem } from './handlers/endRecurringItem.js'
import { registerGetOccurrence } from './handlers/getOccurrence.js'
import { registerGetRecurringItem } from './handlers/getRecurringItem.js'
import { registerListCandidates } from './handlers/listCandidates.js'
import { registerListOccurrences } from './handlers/listOccurrences.js'
import { registerListRecurringItems } from './handlers/listRecurringItems.js'
import { registerListSuggestions } from './handlers/listSuggestions.js'
import { registerListTransactionCandidates } from './handlers/listTransactionCandidates.js'
import { registerListTransactionMatches } from './handlers/listTransactionMatches.js'
import { registerMatchOccurrence } from './handlers/matchOccurrence.js'
import { registerOverrideOccurrence } from './handlers/overrideOccurrence.js'
import { registerUndismissSuggestion } from './handlers/undismissSuggestion.js'
import { registerUnmatchOccurrence } from './handlers/unmatchOccurrence.js'
import { registerUpdateRecurringItem } from './handlers/updateRecurringItem.js'

/**
 * Registers every recurring-item endpoint under `/api/v1/recurring-items`,
 * including single occurrences, matching them to transactions, and
 * dismissing suggested matches.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerRecurringItemRoutes(
  app: FastifyInstance,
  { recurringItems, recurringOccurrences }: Services,
): void {
  registerListRecurringItems(app, recurringItems)
  registerListOccurrences(app, recurringItems)
  registerGetRecurringItem(app, recurringItems)
  registerCreateRecurringItem(app, recurringItems)
  registerUpdateRecurringItem(app, recurringItems)
  registerEndRecurringItem(app, recurringItems)
  registerDeleteRecurringItem(app, recurringItems)
  registerListSuggestions(app, recurringOccurrences)
  registerGetOccurrence(app, recurringOccurrences)
  registerOverrideOccurrence(app, recurringOccurrences)
  registerListCandidates(app, recurringOccurrences)
  registerMatchOccurrence(app, recurringOccurrences)
  registerUnmatchOccurrence(app, recurringOccurrences)
  registerDismissSuggestion(app, recurringOccurrences)
  registerUndismissSuggestion(app, recurringOccurrences)
  registerListTransactionMatches(app, recurringOccurrences)
  registerListTransactionCandidates(app, recurringOccurrences)
}
