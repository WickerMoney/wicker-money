import type { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { MIGRATIONS, StaticMigrationProvider } from './migrations/index.js'
import { TransactionalMigrationProvider } from './TransactionalMigrationProvider.js'
import type { Database } from './models/index.js'

/** Result of a migration run. */
export interface MigrationOutcome {
  /** Names of the migrations that were applied (or reverted), in execution order; empty if none ran. */
  readonly applied: readonly string[]
}

/**
 * Builds the migrator: the bundled migrations, each in its own transaction
 * (see {@link TransactionalMigrationProvider}) instead of one around them all.
 */
function newMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new TransactionalMigrationProvider(new StaticMigrationProvider()),
    disableTransactions: true,
  })
}

/**
 * Applies every pending migration from the bundled migration set.
 *
 * @param db - Database handle; must connect as a role allowed to run DDL.
 * @returns The names of the migrations that were applied.
 * @throws The underlying error if any migration fails; earlier ones stay applied.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<MigrationOutcome> {
  const migrator = newMigrator(db)
  const { error, results } = await migrator.migrateToLatest()
  if (error !== undefined) throw error
  return { applied: (results ?? []).map((r) => r.migrationName) }
}

/**
 * Reverts the single most recently applied migration.
 *
 * @param db - Database handle; must connect as a role allowed to run DDL.
 * @returns The name of the migration that was reverted, or an empty list if none were applied.
 * @throws The underlying error if the revert fails.
 */
export async function migrateDown(db: Kysely<Database>): Promise<MigrationOutcome> {
  const migrator = newMigrator(db)
  const { error, results } = await migrator.migrateDown()
  if (error !== undefined) throw error
  return { applied: (results ?? []).map((r) => r.migrationName) }
}

/**
 * Runs every migration's `up` again, in order, without touching Kysely's
 * bookkeeping table. This is the repair tool for a database that has drifted
 * from the migrations (a dropped index, a changed grant, an unforced table):
 * every `up` is idempotent, so on a healthy database it changes nothing.
 *
 * Everything runs in one transaction while holding the migrator's lock, so a
 * concurrent migrate waits and no other session sees a state in which an
 * earlier migration's definition has been restored but a later migration's
 * replacement of it has not.
 *
 * @param db - Database handle; must connect as a role allowed to run DDL.
 * @returns The names of the migrations that were re-applied, in order.
 * @throws The underlying error if any migration fails; nothing is changed.
 */
export async function reapplyAll(db: Kysely<Database>): Promise<readonly string[]> {
  const names = Object.keys(MIGRATIONS).sort()
  const adapter = db.getExecutor().adapter
  const lock = { lockTable: 'kysely_migration_lock', lockRowId: 'migration_lock' }
  await db.connection().execute(async (conn) => {
    await adapter.acquireMigrationLock(conn, lock)
    try {
      await conn.transaction().execute(async (trx) => {
        for (const name of names) await MIGRATIONS[name]!.up(trx)
      })
    } finally {
      await adapter.releaseMigrationLock(conn, lock)
    }
  })
  return names
}
