import { z } from 'zod'

/** Whether money moves `in` (a credit) or `out` (a debit). */
export const directionBody = z.enum(['in', 'out'])
