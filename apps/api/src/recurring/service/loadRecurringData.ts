import type { Repositories } from '../../data/Repositories.js'
import type { DateRange, RecurringData } from './RecurringData.js'

/**
 * Reads the items, records, links and tracking starts a request needs, once.
 *
 * Call it at most once per request, inside the unit of work's callback, with
 * the span covering everything the request will describe, and pass the result
 * down. See {@link RecurringData} for the scope and staleness rules.
 *
 * @param repos - Repositories of the request's unit of work, under the user's row-level security.
 * @param range - The nominal dates to load records and links for.
 * @returns The snapshot.
 */
export async function loadRecurringData(repos: Repositories, range: DateRange): Promise<RecurringData> {
  const records = await repos.recurringOccurrences.listRecords(range)
  const links = await repos.recurringOccurrences.listLinks(range)
  const trackingStarts = await repos.recurringOccurrences.trackingStarts()
  const items = await repos.recurringItems.list()
  return { range, items, records, links, trackingStarts }
}
