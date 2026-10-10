import { z } from 'zod'

/**
 * Query for listing accounts.
 *
 * `fields=basic` leaves out the derived balance (and so the sum over the
 * ledger) for callers that only need to name accounts; omitted or `full`
 * is the complete shape.
 */
export const listAccountsQuery = z.object({
  includeArchived: z.string().optional(),
  fields: z.enum(['basic', 'full']).optional(),
})
