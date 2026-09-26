import { z } from 'zod'

/** Request body for changing the signed-in user's password. */
export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(1024),
})
