import { z } from 'zod'

/** Query for listing recurring items. */
export const listRecurringItemsQuery = z.object({
  includeEnded: z.enum(['true', 'false']).optional(),
  accountId: z.string().uuid().optional(),
})
