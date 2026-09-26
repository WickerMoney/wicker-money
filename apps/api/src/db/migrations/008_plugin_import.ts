import { sql, type Kysely } from 'kysely'
import { createIndexIfMissing, ensurePolicy, ensureRowSecurity } from './support/index.js'

/**
 * Creates the `plugin_import_csv` schema used by the CSV import plugin:
 * saved column mappings, import batches, and the batch-to-transaction link.
 *
 * A plugin that needs storage gets a schema of its own rather than columns on
 * a core table. That keeps the core schema from accreting one field per
 * feature (denormalised columns nobody can safely recompute), and uninstalling
 * a plugin is a `DROP SCHEMA`.
 *
 * The schema and its tables are created here, by the owner. The plugin's role
 * is granted USAGE and DML but never CREATE: a plugin stores data in its
 * schema, it does not get to reshape it at runtime. The plugin's role and its
 * grants are derived from its manifest when roles are provisioned, not written
 * into this migration. Every table has row-level security keyed on `user_id`.
 *
 * Safe to re-run: existing tables, indexes and policies are left as they are.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS plugin_import_csv`.execute(db)

  /**
   * A saved column mapping, one per source.
   *
   * `date_format` is stored explicitly and never inferred.
   * `MM/DD/YYYY` and `DD/MM/YYYY` are indistinguishable for the first twelve
   * days of any month, so a guess is wrong roughly 30% of the time and wrong
   * silently — the row imports, the date is simply a different day.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_import_csv.source_mappings (
      id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id        uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      source_name    varchar(120) NOT NULL,
      -- Header name per field, e.g. {"date":"Posted Date","amount":"Amount"}.
      -- JSONB rather than columns: the set of mappable fields belongs to the
      -- plugin and will change without a core migration.
      columns        jsonb NOT NULL,
      date_format    varchar(32) NOT NULL,
      -- Some exports put money in one signed column, others split debit and
      -- credit, and some invert the sign. Stored, never guessed.
      amount_style   varchar(32) NOT NULL DEFAULT 'signed',
      invert_amount  boolean NOT NULL DEFAULT false,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await createIndexIfMissing(
    db,
    'plugin_import_csv.ux_source_mappings_user_source',
    'ON plugin_import_csv.source_mappings (user_id, lower(source_name))',
    { unique: true },
  )

  /**
   * One row per import run.
   *
   * Exists so an import can be undone as a unit: it records which rows an
   * import created, so a mis-mapped file can be reverted without hand-written
   * SQL against rows that look like any other transaction.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_import_csv.import_batches (
      id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id        uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      account_id     uuid NOT NULL REFERENCES core.accounts(id) ON DELETE RESTRICT,
      source_name    varchar(120) NOT NULL,
      file_name      varchar(300) NOT NULL,
      rows_total     integer NOT NULL DEFAULT 0,
      rows_imported  integer NOT NULL DEFAULT 0,
      rows_skipped   integer NOT NULL DEFAULT 0,
      rows_flagged   integer NOT NULL DEFAULT 0,
      created_at     timestamptz NOT NULL DEFAULT now(),
      reverted_at    timestamptz
    )
  `.execute(db)
  await createIndexIfMissing(
    db,
    'plugin_import_csv.ix_import_batches_user_created',
    'ON plugin_import_csv.import_batches (user_id, created_at DESC)',
  )

  /**
   * Links a batch to the rows it created.
   *
   * A join table rather than a `batch_id` column on `core.transactions`: the
   * core ledger should not carry a foreign key to a plugin's schema, or core
   * could not be deployed without that plugin. The dependency points one way,
   * from plugin to core, and this is what keeps it that way.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_import_csv.batch_transactions (
      batch_id       uuid NOT NULL REFERENCES plugin_import_csv.import_batches(id) ON DELETE CASCADE,
      transaction_id uuid NOT NULL,
      user_id        uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      PRIMARY KEY (batch_id, transaction_id)
    )
  `.execute(db)
  await createIndexIfMissing(
    db,
    'plugin_import_csv.ix_batch_transactions_transaction',
    'ON plugin_import_csv.batch_transactions (transaction_id)',
  )

  // Same isolation rule as core, for the same reason: a plugin's tables carry
  // user data, so a plugin bug must not become a cross-user data leak. FORCE
  // applies here — no SECURITY DEFINER function touches these tables, so
  // nothing needs the owner exemption.
  for (const table of ['source_mappings', 'import_batches', 'batch_transactions']) {
    const name = `plugin_import_csv.${table}`
    await ensureRowSecurity(db, name, true)
    await ensurePolicy(db, name, `${table}_isolation`, 'user_id = core.current_user_id()')
  }
}

/**
 * Drops the `plugin_import_csv` schema and everything in it.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS plugin_import_csv CASCADE`.execute(db)
}
