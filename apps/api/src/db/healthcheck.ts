import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { bindTenantContext } from './bindTenantContext.js'
import type { Db } from './client.js'

/**
 * Verifies at startup that the database schema has been migrated.
 *
 * The API deliberately does NOT run migrations itself. It connects as the
 * application role, which cannot create schemas, types, policies or functions —
 * that restriction is the foundation of the isolation model, so migrating from
 * here could only work by granting the running application owner-level
 * privilege and undoing it. Migrations are a separate step with a separate
 * identity (the migrate command, run as the database owner).
 *
 * Rather than let a missing schema surface as a confusing permission error deep
 * in a request, this checks once at boot and fails with something actionable.
 *
 * It also verifies the signed tenant context: the key installed in the database
 * must match the running `AUTH_SECRET`, and the application role must not be
 * able to read that key. Without a matching key every tenant query would
 * silently return no rows, so this refuses to start instead.
 *
 * @param db - Application database handle.
 * @throws {Error} With migration instructions if `core.plugins` cannot be read;
 *   the driver error is attached as `cause`. With key-installation instructions
 *   if the tenant-context key is missing or does not match `AUTH_SECRET`, and
 *   with a security message if the application role can read the key.
 */
export async function assertSchemaReady(db: Db): Promise<void> {
  try {
    await sql`SELECT 1 FROM core.plugins LIMIT 1`.execute(db)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Database is not ready: ${detail}\n\n` +
        `The API does not migrate on startup — it connects as a least-privilege\n` +
        `role that cannot create schemas. Run migrations first, as the owner:\n\n` +
        `    pnpm --filter @wickermoney/api migrate\n\n` +
        `That reads DATABASE_OWNER_URL (the database owner) and APP_DB_PASSWORD.`,
      // Keep the driver error reachable; the guidance above is for a human,
      // the cause is for whoever has to debug a case it doesn't cover.
      { cause: error },
    )
  }
  await assertTenantContextReady(db)
}

/**
 * Checks that the database accepts contexts signed with the running secret and
 * does not expose the signing key to the application role.
 *
 * @param db - Application database handle.
 * @throws {Error} As described on {@link assertSchemaReady}.
 */
async function assertTenantContextReady(db: Db): Promise<void> {
  const probe = randomUUID()
  const bound = await db.transaction().execute(async (trx) => {
    await bindTenantContext(trx, probe)
    const { rows } = await sql<{ id: string | null }>`
      SELECT core.current_user_id()::text AS id
    `.execute(trx)
    return rows[0]?.id
  })
  if (bound !== probe) {
    throw new Error(
      `Tenant context key is missing or does not match AUTH_SECRET: the database rejected a\n` +
        `correctly signed user id, so every tenant query would return no rows.\n\n` +
        `Install the key derived from the current AUTH_SECRET (also required after rotating it):\n\n` +
        `    pnpm --filter @wickermoney/api migrate`,
    )
  }
  // A function that still trusts the bare setting (for example an older
  // definition restored by re-running an earlier migration) would accept an
  // unsigned id, so probe that too.
  const unsigned = await db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${probe}, true)`.execute(trx)
    const { rows: seen } = await sql<{ id: string | null }>`
      SELECT core.current_user_id()::text AS id
    `.execute(trx)
    return seen[0]?.id
  })
  if (unsigned !== null && unsigned !== undefined) {
    throw new Error(
      `core.current_user_id() accepts an unsigned user id, so SQL that sets app.user_id could\n` +
        `switch tenant. Re-apply the signing definition as the owner:\n\n` +
        `    pnpm --filter @wickermoney/api migrate reapply`,
    )
  }
  const { rows } = await sql<{ readable: boolean }>`
    SELECT has_table_privilege(current_user, 'core.tenant_context_key', 'SELECT') AS readable
  `.execute(db)
  if (rows[0]?.readable === true) {
    throw new Error(
      `The application role can read core.tenant_context_key, which would let SQL forge any\n` +
        `tenant's identity. Revoke it as the owner:\n\n` +
        `    REVOKE ALL ON core.tenant_context_key FROM <application role>;`,
    )
  }
}

/**
 * Cheap connectivity and schema probe used by the readiness endpoint.
 *
 * @param db - Application database handle.
 * @throws {Error} If `core.plugins` cannot be read.
 */
export async function pingDatabase(db: Db): Promise<void> {
  await sql`SELECT 1 FROM core.plugins LIMIT 1`.execute(db)
}
