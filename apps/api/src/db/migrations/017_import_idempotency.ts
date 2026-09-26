import { sql, type Kysely } from 'kysely'
import { addColumnIfMissing, addConstraintIfMissing, createIndexIfMissing } from './support/index.js'

const TABLE = 'plugin_import_csv.import_batches'
const INDEX = 'ux_import_batches_user_idempotency_key'
const LENGTH_CHECK = 'ck_import_batches_idempotency_key_length'

/**
 * Adds a client idempotency key to import batches.
 *
 * A commit that carries a key is recorded on its batch, and the partial unique
 * index on `(user_id, idempotency_key)` makes a second batch with the same key
 * impossible, whatever the application does. Rows with no key are outside the
 * index, so imports that do not send one behave as before.
 *
 * Every step is safe to run again, and a re-run issues no locking statement. The table's existing table-level DML grant
 * to the plugin role and its row-level security policy cover the new column
 * without change; nothing is re-granted here.
 *
 * The length check is added `NOT VALID` and validated separately: adding it
 * already-validated would scan the table while holding a lock that blocks
 * writes, and the validation step needs only a weaker one.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addColumnIfMissing(db, TABLE, 'idempotency_key', 'text')

  await createIndexIfMissing(
    db,
    `plugin_import_csv.${INDEX}`,
    `ON ${TABLE} (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    { unique: true },
  )

  await addConstraintIfMissing(
    db,
    TABLE,
    LENGTH_CHECK,
    'CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128)',
  )
}

/**
 * Opts out of the migrator's single wrapping transaction so the length check
 * is added `NOT VALID` and validated in separate short transactions.
 */
export const transactional = false

/**
 * Removes the idempotency key, its unique index and its length check.
 *
 * Tolerates the table already being gone.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  const table = sql.raw(TABLE)
  await sql`DROP INDEX IF EXISTS plugin_import_csv.${sql.raw(INDEX)}`.execute(db)
  await sql`ALTER TABLE IF EXISTS ${table} DROP CONSTRAINT IF EXISTS ${sql.raw(LENGTH_CHECK)}`.execute(db)
  await sql`ALTER TABLE IF EXISTS ${table} DROP COLUMN IF EXISTS idempotency_key`.execute(db)
}
