import { sql } from 'kysely'
import { loadConfig } from '../config.js'
import { configureTenantContext } from './configureTenantContext.js'
import { createDb } from './client.js'
import { installTenantContextKey } from './installTenantContextKey.js'
import { appRole } from './migrations/005_app_role.js'
import { migrateDown, migrateToLatest, reapplyAll } from './migrate.js'
import { provisionPluginRoles } from './plugin-roles.js'
import { BUNDLED_PLUGINS } from '../plugins/bundled.js'

/**
 * Migration command-line entry point: `up` (default) applies pending
 * migrations, `down` reverts the most recent one, and `reapply` (`pnpm migrate
 * reapply`) re-runs every migration's idempotent `up` without touching the
 * bookkeeping table, to repair a database that has drifted from the schema.
 *
 * Connects as the database OWNER, not the application role — creating schemas,
 * types, policies, roles and SECURITY DEFINER functions needs privileges the
 * app role deliberately lacks. After `up` it also enables login for the
 * application role (when `APP_DB_PASSWORD` is set), installs the tenant-context
 * signing key derived from `AUTH_SECRET` and re-provisions the per-plugin
 * database roles.
 *
 * Environment: `DATABASE_OWNER_URL` (owner connection, falls back to the
 * deprecated `MIGRATION_DATABASE_URL`, then `DATABASE_URL`) and
 * `APP_DB_PASSWORD`. Sets `process.exitCode = 1` on failure.
 */
const config = loadConfig()
configureTenantContext(config.AUTH_SECRET)

/**
 * Resolves the connection string migrations run on.
 *
 * The owner URL and `DATABASE_URL` point at the SAME database — they differ
 * only in which role connects. The owner can create schemas, types, policies,
 * roles and functions; the application role deliberately cannot, because a
 * role with those privileges also bypasses row-level security.
 *
 * Nothing here reads from any other database. Schema migration means applying
 * the bundled numbered DDL migrations, not moving data between systems.
 *
 * @returns `DATABASE_OWNER_URL` if set, else the deprecated
 *   `MIGRATION_DATABASE_URL` (with a warning), else `DATABASE_URL`.
 */
function ownerUrl(): string {
  const owner = process.env['DATABASE_OWNER_URL']
  if (owner !== undefined && owner !== '') return owner

  const legacy = process.env['MIGRATION_DATABASE_URL']
  if (legacy !== undefined && legacy !== '') {
    console.warn(
      'NOTE: MIGRATION_DATABASE_URL is deprecated — rename it to DATABASE_OWNER_URL.\n' +
        '      It was never a "migrate from" source; it is the owner connection for\n' +
        '      the same database DATABASE_URL points at.',
    )
    return legacy
  }
  return config.DATABASE_URL
}

const url = ownerUrl()
const db = createDb(url)
// The last argument wins, so `pnpm migrate reapply` (the script already passes
// `up`) selects reapply.
const direction = process.argv.slice(2).at(-1) ?? 'up'

/**
 * Gives the application role a password and the right to log in.
 *
 * The migrations create the application role as NOLOGIN with no password on
 * purpose: roles are cluster-scoped and a migration file is the wrong place
 * for a secret. That leaves exactly one step between "migrated" and "the API
 * can connect", and this is it. Idempotent, so it is safe on every deploy.
 *
 * @param password - Password to set on the application role.
 */
async function configureAppRole(password: string): Promise<void> {
  const role = sql.raw(appRole())
  await sql`ALTER ROLE ${role} LOGIN PASSWORD ${sql.lit(password)}`.execute(db)

  const { rows } = await sql<{ current_database: string }>`
    SELECT current_database()
  `.execute(db)
  const database = rows[0]!.current_database
  await sql`GRANT CONNECT ON DATABASE ${sql.raw(`"${database}"`)} TO ${role}`.execute(db)
}

try {
  if (direction === 'down') {
    const { applied } = await migrateDown(db)
    console.log(applied.length === 0 ? 'Nothing to roll back.' : `Reverted: ${applied.join(', ')}`)
  } else {
    if (direction === 'reapply') {
      console.log(`Re-applied: ${(await reapplyAll(db)).join(', ')}`)
    } else {
      const { applied } = await migrateToLatest(db)
      console.log(
        applied.length === 0 ? 'Database already up to date.' : `Applied: ${applied.join(', ')}`,
      )
    }

    // Signed tenant context: the database verifies a key derived from
    // AUTH_SECRET, so it is (re)installed on every migrate. This is also the
    // step to run after rotating AUTH_SECRET.
    await installTenantContextKey(db)
    console.log('Tenant context key installed from AUTH_SECRET.')

    const appPassword = process.env['APP_DB_PASSWORD']
    if (appPassword === undefined || appPassword === '') {
      console.warn(
        `\nWARNING: APP_DB_PASSWORD is not set, so the '${appRole()}' role still cannot log in.\n` +
          `The API will fail to connect until it can. Set APP_DB_PASSWORD and re-run, or grant it manually:\n` +
          `  ALTER ROLE ${appRole()} LOGIN PASSWORD '<password>';`,
      )
    } else {
      await configureAppRole(appPassword)
      console.log(`Role '${appRole()}' configured: LOGIN granted, password set.`)
    }

    // Plugin roles are derived from manifests, so they are refreshed here on
    // every migrate rather than frozen into a migration. Changing a plugin's
    // requiredTables and redeploying is all it takes for the database to agree.
    const provisioned = await provisionPluginRoles(db, BUNDLED_PLUGINS)
    for (const p of provisioned) {
      // The schema is named explicitly, including when there isn't one. A
      // plugin whose migration created `plugin_import` while the derivation
      // rule asks for `plugin_import_csv` is otherwise indistinguishable from
      // a plugin that owns no storage — the grant is simply skipped, and the
      // failure only shows up as "permission denied for schema" at runtime.
      console.log(
        `Plugin role '${p.role}' (${p.pluginId}) schema=${p.schema ?? 'none'}: ${p.grants.join('; ')}`,
      )
    }
  }
} catch (error) {
  console.error('Migration failed:', error)
  process.exitCode = 1
} finally {
  await db.destroy()
}
