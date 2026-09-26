import { sql } from 'kysely'
import type { Executor } from './Executor.js'

/**
 * Creates a row-level-security policy (for all commands) unless one with that
 * name already exists on the table.
 *
 * An existing policy is left alone rather than rewritten: creating, altering
 * and dropping a policy each take an exclusive table lock, and a policy's
 * definition only changes through a migration written for that change.
 *
 * Every argument is spliced into the statement as SQL, so pass constants only.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name.
 * @param name - Policy name.
 * @param expression - Predicate used as both the `USING` and the `WITH CHECK` clause.
 */
export async function ensurePolicy(
  db: Executor,
  table: string,
  name: string,
  expression: string,
): Promise<void> {
  const { rows } = await sql<{ found: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_policy WHERE polrelid = to_regclass(${table}) AND polname = ${name}
    ) AS found
  `.execute(db)
  if (rows[0]?.found === true) return
  await sql`
    CREATE POLICY ${sql.raw(name)} ON ${sql.raw(table)}
      USING (${sql.raw(expression)}) WITH CHECK (${sql.raw(expression)})
  `.execute(db)
}
