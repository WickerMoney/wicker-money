import { sql } from 'kysely'

/**
 * The database clock, used for timestamps the repository stamps on writes.
 *
 * Using the same clock as the columns' `DEFAULT now()` keeps `updated_at`
 * from ever sorting before `created_at` when the application host's clock
 * disagrees with the database server's.
 */
export const databaseNow = sql<Date>`now()`
