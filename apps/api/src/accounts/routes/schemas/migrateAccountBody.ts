import { z } from 'zod'

/** Request body naming the account that an account's history would be moved into. */
export const migrateAccountBody = z.object({ toAccountId: z.string().uuid() })
