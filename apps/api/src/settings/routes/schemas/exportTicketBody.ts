import { z } from 'zod'

/** Request body for minting an export ticket: the account password, checked again. */
export const exportTicketBody = z.object({
  password: z.string().min(1, 'Enter your password.').max(1024),
})
