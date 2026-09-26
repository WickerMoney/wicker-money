import { sql } from 'kysely'
import type { Executor } from './Executor.js'

/**
 * Brings a table's row-level-security flags to the requested state, touching
 * the table only for a flag that differs.
 *
 * Toggling these flags takes an exclusive lock on the table even when the flag
 * already has the requested value, so the current state is read first.
 *
 * @param db - Migration connection.
 * @param table - Schema-qualified table name; spliced into the statement as SQL, so pass a constant.
 * @param force - Whether the table owner is subject to the policies as well (`FORCE`).
 */
export async function ensureRowSecurity(
  db: Executor,
  table: string,
  force: boolean,
): Promise<void> {
  const { rows } = await sql<{ enabled: boolean; forced: boolean }>`
    SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
    FROM pg_class WHERE oid = to_regclass(${table})
  `.execute(db)
  const state = rows[0]
  if (state === undefined) throw new Error(`Table ${table} does not exist`)
  const target = sql.raw(table)
  if (!state.enabled) await sql`ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`.execute(db)
  if (state.forced !== force) {
    await (force
      ? sql`ALTER TABLE ${target} FORCE ROW LEVEL SECURITY`
      : sql`ALTER TABLE ${target} NO FORCE ROW LEVEL SECURITY`
    ).execute(db)
  }
}
