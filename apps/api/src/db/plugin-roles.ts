import { sql } from 'kysely'
import type { Db } from './client.js'
import type { PluginManifest, TableGrant } from '@wickermoney/plugin-sdk'
import { appRole } from './migrations/005_app_role.js'

/**
 * @module
 * A PostgreSQL role per plugin, with grants derived from its manifest.
 *
 * This is the layer that makes `requiredTables` enforceable rather than
 * documentation. An application-level manifest check catches the honest
 * mistake; this is the layer that holds when that check is wrong, because it
 * is the database refusing the query rather than the application choosing not
 * to issue it.
 *
 * Grants are computed from the manifest on every migrate run rather than
 * written into a migration. A manifest is the declaration; duplicating it in
 * DDL would create two sources of truth that drift the first time a plugin
 * needs one more table. Re-running narrows as well as widens: privileges are
 * revoked wholesale first, then re-granted from the current manifest, so
 * removing a table from `requiredTables` actually removes the grant.
 *
 * The application role is granted membership in each plugin role, which is what
 * lets a request switch identity with `SET LOCAL ROLE` instead of holding a
 * separate connection pool per plugin. Membership is one-directional: the app
 * role can become a plugin role, never the reverse, and a plugin role is
 * NOLOGIN so it is not an entry point of its own.
 */

/**
 * Derives the PostgreSQL role name for a plugin.
 *
 * The name is namespaced under the application role: PostgreSQL roles are
 * CLUSTER-wide, so two Wicker Money databases on one server owned by different
 * roles would otherwise fight over the same plugin role — and the second owner
 * cannot even GRANT a role it does not hold ADMIN on, so the failure would be
 * a confusing permission error during migration. Consequently `APP_DB_ROLE`
 * must be set identically for the migrate command and the API process.
 *
 * @param pluginId - Plugin manifest id.
 * @returns The role name.
 * @throws {Error} If the resulting name exceeds PostgreSQL's 63-character limit.
 * @example
 * pluginRoleName('wickermoney.import-csv') // 'wickermoney_app_plugin_import_csv' (default app role)
 */
export function pluginRoleName(pluginId: string): string {
  const slug = pluginId.replace(/^wickermoney\./, '').replace(/[^a-z0-9]+/g, '_')
  const name = `${appRole()}_plugin_${slug}`
  if (name.length > 63) {
    throw new Error(
      `Plugin role name '${name}' exceeds PostgreSQL's 63-character limit. ` +
        `Shorten APP_DB_ROLE or the plugin id.`,
    )
  }
  return name
}

/**
 * Derives the name of the schema a plugin would own its storage in.
 *
 * The schema may not exist; {@link provisionPluginRole} checks the catalog
 * before granting on it.
 *
 * @param pluginId - Plugin manifest id.
 * @returns The schema name, e.g. `plugin_import_csv` for `wickermoney.import-csv`.
 */
export function pluginSchemaName(pluginId: string): string {
  return `plugin_${pluginId.replace(/^wickermoney\./, '').replace(/[^a-z0-9]+/g, '_')}`
}

/** A plain lowercase PostgreSQL identifier, safe to interpolate as a name. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Validates a name before it is interpolated into DDL.
 *
 * @param name - Candidate identifier.
 * @param what - Description used in the error message.
 * @returns `name`, unchanged.
 * @throws {Error} If `name` is not a lowercase identifier.
 */
function checkedIdentifier(name: string, what: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`${what} must be a lowercase identifier, got: ${name}`)
  }
  return name
}

/**
 * Maps a manifest table grant to the SQL privilege list.
 *
 * `'read'` is SELECT only. `'write'` is full DML, DELETE included: a plugin
 * that can add ledger rows but never remove them cannot offer undo, and undo is
 * what makes a bulk import safe to attempt. The narrowing comes from elsewhere
 * — row-level security confines every statement to the acting user's own rows.
 *
 * @param grant - A `requiredTables` entry from a plugin manifest.
 * @returns Comma-separated privileges for a `GRANT` statement.
 */
function privilegesFor(grant: TableGrant): string {
  return grant.access === 'write' ? 'SELECT, INSERT, UPDATE, DELETE' : 'SELECT'
}

/** What {@link provisionPluginRole} did for one plugin. */
export interface ProvisionResult {
  /** Plugin manifest id. */
  readonly pluginId: string
  /** Name of the plugin's database role. */
  readonly role: string
  /** The plugin's own schema, or `null` if no such schema exists (so no schema grant was made). */
  readonly schema: string | null
  /** Human-readable list of the grants applied, one per table or schema. */
  readonly grants: readonly string[]
}

/**
 * Creates or updates one plugin's role so it matches its manifest. Must run as
 * the database owner.
 *
 * Idempotent: existing table privileges on `core` are revoked first and then
 * re-granted from the manifest, so the result is exactly what the manifest
 * declares. If the plugin's own schema exists the role gets full DML on it
 * (but not CREATE), including default privileges for tables added later.
 * Finally the application role is made a member of the plugin role.
 *
 * @param db - Database handle connected as the database owner.
 * @param manifest - Plugin manifest whose `requiredTables` drive the grants.
 * @returns A summary of the role and grants applied.
 * @throws {Error} If the role name is too long or any granted table name is not a plain identifier.
 */
export async function provisionPluginRole(
  db: Db,
  manifest: PluginManifest,
): Promise<ProvisionResult> {
  const role = checkedIdentifier(pluginRoleName(manifest.id), 'Plugin role name')
  const schema = pluginSchemaName(manifest.id)
  const r = sql.raw(role)

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sql.lit(role)}) THEN
        EXECUTE format('CREATE ROLE %I NOLOGIN', ${sql.lit(role)});
      END IF;
    END
    $$
  `.execute(db)

  // Revoke before granting so the manifest is authoritative in both directions.
  await sql`REVOKE ALL ON ALL TABLES IN SCHEMA core FROM ${r}`.execute(db)

  await sql`GRANT USAGE ON SCHEMA core TO ${r}`.execute(db)
  // RLS policies call this; without EXECUTE every policy errors instead of
  // filtering, which looks like a broken plugin rather than a missing grant.
  await sql`GRANT EXECUTE ON FUNCTION core.current_user_id() TO ${r}`.execute(db)

  const grants: string[] = []
  for (const grant of manifest.requiredTables) {
    const table = checkedIdentifier(grant.table, 'Granted table')
    const privileges = privilegesFor(grant)
    await sql`GRANT ${sql.raw(privileges)} ON ${sql.raw(`core.${table}`)} TO ${r}`.execute(db)
    grants.push(`core.${table}: ${privileges}`)
  }

  // A plugin's own schema, when the migrations created one for it.
  const { rows } = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_namespace WHERE nspname = ${schema}
    ) AS exists
  `.execute(db)
  const ownsSchema = rows[0]?.exists === true

  if (ownsSchema) {
    const s = sql.raw(checkedIdentifier(schema, 'Plugin schema name'))
    await sql`GRANT USAGE ON SCHEMA ${s} TO ${r}`.execute(db)
    await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${r}`.execute(db)
    await sql`
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${s}
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}
    `.execute(db)
    // Deliberately not CREATE: a plugin stores data in its schema, it does not
    // reshape it at runtime.
    grants.push(`${schema}: SELECT, INSERT, UPDATE, DELETE`)
  }

  // Lets the API assume this identity per transaction rather than per pool.
  await sql`GRANT ${r} TO ${sql.raw(appRole())}`.execute(db)

  return { pluginId: manifest.id, role, schema: ownsSchema ? schema : null, grants }
}

/**
 * Provisions the roles for a set of plugins, sequentially.
 *
 * @param db - Database handle connected as the database owner.
 * @param manifests - Manifests to provision.
 * @returns One {@link ProvisionResult} per manifest, in input order.
 * @throws {Error} As {@link provisionPluginRole}; stops at the first failure.
 */
export async function provisionPluginRoles(
  db: Db,
  manifests: readonly PluginManifest[],
): Promise<ProvisionResult[]> {
  const results: ProvisionResult[] = []
  for (const manifest of manifests) {
    results.push(await provisionPluginRole(db, manifest))
  }
  return results
}
