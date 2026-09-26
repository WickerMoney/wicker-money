import type { z } from 'zod'
import type { tableGrantSchema } from './tableGrantSchema.js'

/** A request for `read` or `write` access to one core table, as declared in a manifest's `requiredTables`. */
export type TableGrant = z.infer<typeof tableGrantSchema>
