import { sql } from 'kysely'
import { asPlugin, asUser, type Db } from '../db/client.js'
import type { Trx } from '../db/Trx.js'
import { pluginRoleName, pluginSchemaName } from '../db/plugin-roles.js'
import { BUNDLED_PLUGINS } from '../plugins/bundled.js'

/**
 * @module
 * Test support for asking "what does the database hold for this user?" without
 * a list of tables written into the test. The catalog is the list, so a table
 * a later migration adds is counted the day it exists.
 */

/** Every `schema.table` in `core` or a `plugin_` schema that has a `user_id` column, sorted. */
export async function userTables(db: Db): Promise<readonly string[]> {
  const { rows } = await sql<{ name: string }>`
    SELECT n.nspname || '.' || c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND (n.nspname = 'core' OR starts_with(n.nspname, 'plugin_'))
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
      )
    ORDER BY 1
  `.execute(db)
  return rows.map((r) => r.name)
}

/**
 * The id of the bundled plugin whose schema `schema` is.
 *
 * @throws {Error} If no bundled plugin owns the schema, so a new plugin schema
 *   fails a test that counts rows until the test knows how to reach it.
 */
export function pluginIdOfSchema(schema: string): string {
  const owner = BUNDLED_PLUGINS.find((m) => pluginSchemaName(m.id) === schema)
  if (owner === undefined) throw new Error(`No bundled plugin owns the schema ${schema}.`)
  return owner.id
}

/**
 * How many rows each user-data table holds for `userId`, counted the way the
 * user's own requests would see them: core tables under the user's row-level
 * security, a plugin's tables under that plugin's database role. Sessions are
 * included.
 *
 * @param db - The application database handle.
 * @param userId - Whose rows to count.
 * @returns A count per `schema.table`.
 */
export async function rowsOwnedBy(db: Db, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of await userTables(db)) {
    const schema = table.slice(0, table.indexOf('.'))
    const count = async (trx: Trx) => {
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM ${sql.table(table)} WHERE user_id = ${userId}::uuid
      `.execute(trx)
      return rows[0]?.n ?? 0
    }
    counts[table] =
      schema === 'core'
        ? await asUser(db, userId, count)
        : await asPlugin(db, pluginRoleName(pluginIdOfSchema(schema)), userId, count)
  }
  return counts
}

/** Sets an account's role as the database owner, which row-level security does not bind. */
export async function setRole(admin: Db, userId: string, role: 'owner' | 'member'): Promise<void> {
  await sql`UPDATE core.users SET role = ${role}::core.user_role WHERE id = ${userId}::uuid`.execute(admin)
}

/** The session family (the `sid` claim) of an access token. */
export function familyIdOf(accessToken: string): string {
  const payload = accessToken.split('.')[1]
  if (payload === undefined) throw new Error('Not a JWT.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sid?: string }
  if (claims.sid === undefined) throw new Error('The token has no sid claim.')
  return claims.sid
}
