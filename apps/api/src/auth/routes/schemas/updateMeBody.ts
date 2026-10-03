import { z } from 'zod'

/** Request body for updating the signed-in user's own profile. Only the time zone can change for now. */
export const updateMeBody = z.object({
  timezone: z.string().min(1).max(64),
}).strict()
