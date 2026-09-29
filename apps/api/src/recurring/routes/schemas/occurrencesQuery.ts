import { z } from 'zod'
import { isoDate } from '../../../transactions/routes/schemas/isoDate.js'

/** Query for an occurrences request: a half-open `[from, to)`, both optional. */
export const occurrencesQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() })
