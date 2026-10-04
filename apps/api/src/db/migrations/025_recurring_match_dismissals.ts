import { sql, type Kysely } from 'kysely'
import {
  addUniqueConstraintIfMissing,
  createIndexIfMissing,
  dropConstraintIfExists,
  ensurePolicy,
  ensureRowSecurity,
} from './support/index.js'

/**
 * @module
 * Dismissed match suggestions: "this transaction is not that occurrence".
 *
 * Matching suggests a transaction for an occurrence and waits for the user to
 * confirm it. When the guess is wrong (a hardware-store purchase that happens
 * to be close to the internet bill), the user can dismiss it, and that pair is
 * never suggested again. The same transaction can still be suggested for any
 * other occurrence, and the same occurrence for any other transaction.
 *
 * `core.recurring_match_dismissals` holds one row per dismissed pair. The
 * occurrence side is keyed by `(recurring_item_id, nominal_date)`, the
 * occurrence's identity, and deliberately not by a `core.recurring_occurrences`
 * row. Those rows are created lazily and deleted again as soon as nothing is
 * recorded on them (`deleteIfEmpty`), so pointing at one would either keep an
 * otherwise empty row alive, which every "is anything recorded here?" check
 * would then have to know about, or lose the dismissal when the row went. An
 * occurrence that never had a row can be dismissed against too.
 *
 * Every reference is a composite `(user_id, ...)` key (lesson #8), so one
 * user's dismissal can never name another user's transaction or item.
 * Deleting the transaction or the recurring item deletes its dismissals. A
 * schedule edit that moves the item's dates leaves dismissals on dates the
 * schedule no longer has; like occurrence records, they are ignored.
 *
 * The composite key on the transaction needs `UNIQUE (user_id, id)` on
 * `core.transactions`, which no earlier migration added. The unique index is
 * built first and then attached as the constraint
 * (`addUniqueConstraintIfMissing`), so the build holds a SHARE lock (reads
 * continue, writes wait for one index build over two uuid columns) rather
 * than an exclusive one.
 *
 * Every step checks before it acts, so a re-run changes nothing and takes no
 * lock on the ledger.
 */

/** Runs each step in its own statement, so no lock is held across steps. */
export const transactional = false

const TABLE = 'core.recurring_match_dismissals'
const TRANSACTIONS_KEY = 'uq_transactions_user_id_id'

/**
 * Applies the change. See the module comment.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addUniqueConstraintIfMissing(db, 'core.transactions', TRANSACTIONS_KEY, 'user_id, id')

  await sql`
    CREATE TABLE IF NOT EXISTS core.recurring_match_dismissals (
      id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id           uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      transaction_id    uuid NOT NULL,
      recurring_item_id uuid NOT NULL,
      -- The occurrence's identity, as in core.recurring_occurrences.
      nominal_date      date NOT NULL,
      created_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_recurring_match_dismissals_pair UNIQUE (transaction_id, recurring_item_id, nominal_date),
      CONSTRAINT fk_recurring_match_dismissals_transaction_id_owned
        FOREIGN KEY (user_id, transaction_id) REFERENCES core.transactions (user_id, id) ON DELETE CASCADE,
      CONSTRAINT fk_recurring_match_dismissals_recurring_item_id_owned
        FOREIGN KEY (user_id, recurring_item_id) REFERENCES core.recurring_items (user_id, id) ON DELETE CASCADE
    )
  `.execute(db)
  await createIndexIfMissing(db, 'core.ix_recurring_match_dismissals_user_id', `ON ${TABLE} (user_id)`)
  // Suggestions read by occurrence; deleting an item cascades by it. The
  // unique constraint already covers lookups and cascades by transaction.
  await createIndexIfMissing(
    db,
    'core.ix_recurring_match_dismissals_item_nominal',
    `ON ${TABLE} (recurring_item_id, nominal_date)`,
  )
  await ensureRowSecurity(db, TABLE, true)
  await ensurePolicy(db, TABLE, 'recurring_match_dismissals_isolation', 'user_id = (SELECT core.current_user_id())')
  // No GRANT: migration 005's default privileges give the application role
  // DML on every table created in `core`.
}

/**
 * Removes dismissals, and the ledger key that only they use.
 *
 * Reversible because nothing else depends on it: dropping the table only
 * means previously dismissed suggestions are offered again. Matches,
 * skips and moves are untouched.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS core.recurring_match_dismissals`.execute(db)
  await dropConstraintIfExists(db, 'core.transactions', TRANSACTIONS_KEY)
}
