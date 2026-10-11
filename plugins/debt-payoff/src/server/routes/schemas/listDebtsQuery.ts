import { z } from 'zod'

/** The query string of `GET /debts`: `includeArchived=true` lists archived debts too. */
export const listDebtsQuery = z.object({
  includeArchived: z.enum(['true', 'false'], { error: 'Send true or false.' }).optional(),
})
