import { sql, type Kysely } from 'kysely'
import { createIndexIfMissing } from './support/index.js'

/**
 * @module
 * Deployment log: one row per API boot, recording the version that started.
 *
 * Not tenant data, and not RLS-scoped — nothing here is per-user. It exists so
 * an incident or a bad migration can be correlated with the version that was
 * actually running, which the image tag alone does not answer once several
 * deploys have happened without anyone keeping notes.
 *
 * No explicit GRANT is needed: migration 005 already sets `ALTER DEFAULT
 * PRIVILEGES IN SCHEMA core GRANT ... ON TABLES TO <app role>`, so a table
 * created here (by the same owner role that ran that migration) inherits the
 * grant automatically.
 */

/**
 * Creates `core.app_deployments`.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS core.app_deployments (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      version text NOT NULL,
      git_sha text,
      started_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  // Newest-first is the only access pattern today (the About page, and any
  // future "recent deploys" view). Uses createIndexIfMissing rather than a
  // raw `CREATE INDEX IF NOT EXISTS`: that raw form takes a blocking SHARE
  // lock on the table before it notices the index already exists, which
  // failed migrations.idempotent.integration.test.ts's lock check on
  // reapply (see that helper's docstring for why it checks the catalog
  // first instead).
  await createIndexIfMissing(
    db,
    'core.ix_app_deployments_started_at',
    'ON core.app_deployments (started_at DESC)',
  )
}

/**
 * Drops `core.app_deployments`.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS core.app_deployments`.execute(db)
}
