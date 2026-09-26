import { sql } from 'kysely'
import type { Executor } from './Executor.js'

/**
 * Creates an enum type unless a type of that name exists.
 *
 * An existing type is left as it is, including any values added to it since.
 *
 * @param db - Migration connection.
 * @param qualifiedName - Schema-qualified type name; spliced into the statement as SQL, so pass a constant.
 * @param values - Enum labels, in order.
 */
export async function createEnumIfMissing(
  db: Executor,
  qualifiedName: string,
  values: readonly string[],
): Promise<void> {
  const { rows } = await sql<{ found: boolean }>`
    SELECT to_regtype(${qualifiedName}) IS NOT NULL AS found
  `.execute(db)
  if (rows[0]?.found === true) return
  const labels = sql.join(values.map((v) => sql.lit(v)))
  await sql`CREATE TYPE ${sql.raw(qualifiedName)} AS ENUM (${labels})`.execute(db)
}
