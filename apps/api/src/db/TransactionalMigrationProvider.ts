import type { Migration, MigrationProvider } from 'kysely/migration'

/**
 * Migration provider that wraps each migration in its own transaction, unless
 * the migration opts out by exporting `transactional = false`.
 *
 * The migrator is run without its usual single transaction around every
 * pending migration: locks taken by DDL are held until the transaction ends,
 * so one transaction across all of them keeps the exclusive locks of an early
 * migration in force through the last. Per-migration transactions keep each
 * migration atomic while bounding the locks to that migration. A migration
 * that exports `transactional = false` manages its own short transactions so
 * that a slow validation or index build is not covered by an exclusive lock.
 * Such a migration must be safe to re-run, because a failure part-way leaves
 * its earlier steps committed.
 */
export class TransactionalMigrationProvider implements MigrationProvider {
  /**
   * @param inner - Provider of the unwrapped migrations.
   */
  constructor(private readonly inner: MigrationProvider) {}

  /** @returns The inner migrations, each wrapped according to its `transactional` export. */
  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations = await this.inner.getMigrations()
    const wrapped: Record<string, Migration> = {}
    for (const [name, migration] of Object.entries(migrations)) {
      const transactional = (migration as { transactional?: boolean }).transactional !== false
      wrapped[name] = transactional
        ? {
            up: (db) => db.transaction().execute((trx) => migration.up(trx)),
            ...(migration.down === undefined
              ? {}
              : { down: (db) => db.transaction().execute((trx) => migration.down!(trx)) }),
          }
        : migration
    }
    return wrapped
  }
}
