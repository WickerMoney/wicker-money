import { sql, type Kysely } from 'kysely'

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
  // future "recent deploys" view).
  await sql`
    CREATE INDEX IF NOT EXISTS ix_app_deployments_started_at
      ON core.app_deployments (started_at DESC)
  `.execute(db)
}

/**
 * Drops `core.app_deployments`.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS core.app_deployments`.execute(db)
}
