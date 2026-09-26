import { sql } from 'kysely'
import type { Executor } from './Executor.js'

/**
 * Tells whether a live (not dropped) column exists.
 *
 * Reads the catalog instead of issuing `ADD COLUMN IF NOT EXISTS`, because
 * `ALTER TABLE` takes its exclusive lock before noticing there is nothing to do.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name.
 * @param column - Column name.
 * @returns True when the column exists.
 */
export async function columnExists(db: Executor, table: string, column: string): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass(${table})
        AND attname = ${column}
        AND attnum > 0
        AND NOT attisdropped
    ) AS found
  `.execute(db)
  return rows[0]?.found === true
}
