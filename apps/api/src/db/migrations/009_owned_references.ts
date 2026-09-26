import { sql, type Kysely } from 'kysely'
import {
  addConstraintIfMissing,
  addUniqueConstraintIfMissing,
  dropConstraintIfExists,
} from './support/index.js'

/**
 * @module
 * Replaces single-column foreign keys between owned tables with composite
 * `(user_id, <parent>_id)` keys, making cross-user references impossible
 * rather than merely unusual.
 *
 * Row-level security decides which rows a query can *see*. It does not
 * constrain what a row may *point at*: PostgreSQL evaluates a foreign key with
 * the privileges of the referenced table's owner and deliberately bypasses RLS
 * while doing so, because a constraint that could be defeated by not being able
 * to see the parent row would not be a constraint at all.
 *
 * The consequence is not obvious: with only a single-column foreign key,
 * nothing stops one user inserting a transaction whose `account_id` belongs to
 * someone else. The row is invisible to that account's owner — policies are
 * keyed on `user_id`, which is the *inserting* user — but it is real, it
 * references a stranger's account, and it would surface in any query that
 * joined the two.
 *
 * An application-level check would fix the endpoints that remember to call it.
 * A composite foreign key fixes it for every writer, now and later, including
 * plugins: `(user_id, account_id)` must match a row in `accounts` that has both
 * that id AND that owner. There is no path around it.
 *
 * Every user-supplied reference between two owned tables gets the same
 * treatment, since each one is the same latent bug.
 */

/** Owned references converted to composite keys: `table.column` points at `parent`. */
const REFERENCES = [
  { table: 'transactions', column: 'account_id', parent: 'accounts' },
  { table: 'transactions', column: 'transfer_account_id', parent: 'accounts' },
  { table: 'transactions', column: 'category_id', parent: 'categories' },
  { table: 'transaction_splits', column: 'category_id', parent: 'categories' },
  { table: 'category_rules', column: 'category_id', parent: 'categories' },
] as const

/** Parent tables that receive a `UNIQUE (user_id, id)` constraint so composite foreign keys can target them. */
const PARENTS = ['accounts', 'categories'] as const

/**
 * Tells the migrator to run this migration without wrapping it in a
 * transaction, so each foreign key is validated in a statement of its own.
 *
 * Every step is idempotent, so an interrupted run is simply run again.
 */
export const transactional = false

/**
 * Adds `UNIQUE (user_id, id)` to the parent tables, then adds a composite
 * `(user_id, column)` foreign key (`ON DELETE RESTRICT`) for each listed
 * reference and drops the single-column one it replaces.
 *
 * Safe to re-run: constraints that already exist and are validated are skipped.
 * Each foreign key is added `NOT VALID` and validated separately, which scans
 * the table without blocking reads or writes; the unique constraints are built
 * from an index first for the same reason.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // A composite FK needs a unique constraint covering exactly its target
  // columns. `id` is already the primary key, so this adds nothing a query
  // planner needs — it exists purely to be referenceable.
  for (const parent of PARENTS) {
    await addUniqueConstraintIfMissing(db, `core.${parent}`, `uq_${parent}_user_id_id`, 'user_id, id')
  }

  for (const { table, column, parent } of REFERENCES) {
    await addConstraintIfMissing(
      db,
      `core.${table}`,
      `fk_${table}_${column}_owned`,
      `FOREIGN KEY (user_id, ${column}) REFERENCES core.${parent} (user_id, id) ON DELETE RESTRICT`,
    )
    // The old single-column FK is dropped: leaving both would keep the weaker
    // one enforcing nothing extra while implying it still matters.
    await dropConstraintIfExists(db, `core.${table}`, `${table}_${column}_fkey`)
  }
}

/**
 * Restores the original single-column foreign keys and drops the composite
 * keys and the `UNIQUE (user_id, id)` constraints.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const { table, column, parent } of REFERENCES) {
    await sql`
      ALTER TABLE ${sql.raw(`core.${table}`)}
        DROP CONSTRAINT IF EXISTS ${sql.raw(`fk_${table}_${column}_owned`)}
    `.execute(db)
    await sql`
      ALTER TABLE ${sql.raw(`core.${table}`)}
        ADD CONSTRAINT ${sql.raw(`${table}_${column}_fkey`)}
        FOREIGN KEY (${sql.raw(column)}) REFERENCES ${sql.raw(`core.${parent}`)} (id)
        ON DELETE RESTRICT
    `.execute(db)
  }
  for (const parent of PARENTS) {
    await sql`
      ALTER TABLE ${sql.raw(`core.${parent}`)}
        DROP CONSTRAINT IF EXISTS ${sql.raw(`uq_${parent}_user_id_id`)}
    `.execute(db)
  }
}
