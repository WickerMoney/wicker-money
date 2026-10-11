import { z } from 'zod'

/** Request body for giving an account a role. */
export const setUserRoleBody = z.object({
  role: z.enum(['owner', 'member']),
}).strict()
