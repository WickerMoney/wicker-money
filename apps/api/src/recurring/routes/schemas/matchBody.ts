import { z } from 'zod'

/** Request body matching a transaction to an occurrence. */
export const matchBody = z.object({ transactionId: z.string().uuid() })
