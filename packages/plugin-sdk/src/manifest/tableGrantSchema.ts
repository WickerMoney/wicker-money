import { z } from 'zod'
import { CORE_TABLES } from './CORE_TABLES.js'

/** Validates one entry of a manifest's `requiredTables`: a core table and the access level requested on it. */
export const tableGrantSchema = z.object({
  /** The core table the plugin wants to reach. */
  table: z.enum(CORE_TABLES),
  /** `read` allows selecting rows; `write` also allows inserting, updating and deleting them. */
  access: z.enum(['read', 'write']),
})
