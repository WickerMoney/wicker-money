import { sql, type Kysely } from 'kysely'
import {
  addColumnIfMissing,
  addConstraintIfMissing,
  createIndexIfMissing,
  ensurePolicy,
  ensureRowSecurity,
} from './support/index.js'

/**
 * @module
 * Paid / landed matching: what happened to one occurrence of a recurring item.
 *
 * An occurrence is identified by `(recurring_item_id, nominal_date)`, the date
 * the schedule gives, which never moves even when the payment does. Nothing is
 * stored for an occurrence until something about it is recorded, so a series
 * with no history costs no rows.
 *
 * - `core.recurring_occurrences` holds the per-occurrence overrides: skipped,
 *   or expected on another date (`expected_date`, for a holiday or a bank
 *   that posts early).
 * - `core.recurring_occurrence_legs` overrides one leg's amount for one
 *   occurrence, keyed by account like the item's own legs, so one side of a
 *   split paycheck can change without the other. A leg with no row here uses
 *   the item's amount.
 * - `core.transactions.recurring_occurrence_id` links a ledger transaction to
 *   the occurrence it settles. One occurrence can be settled by several
 *   transactions, one per leg: a split paycheck lands as two deposits, a
 *   transfer as its two rows. A transaction settles at most one occurrence.
 *
 * Every reference is a composite `(user_id, ...)` key (lesson #8). Deleting a
 * recurring item removes its occurrences and unlinks their transactions
 * (`SET NULL` on the link column only; the transaction itself stays, because
 * it is the history). Deleting an account removes the occurrence amounts on it.
 *
 * Purely additive: no backfill, and every step checks before it acts, so a
 * re-run changes nothing and takes no blocking lock.
 */

/**
 * Runs each step in its own statement, so `addConstraintIfMissing` can add the
 * transactions foreign key `NOT VALID` and validate it without holding a lock
 * that blocks writes to the ledger.
 */
export const transactional = false

/**
 * Applies the change. See the module comment.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ---- occurrences --------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS core.recurring_occurrences (
      id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id           uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      recurring_item_id uuid NOT NULL,
      -- The schedule's date for this occurrence: its identity. Never shifted.
      nominal_date      date NOT NULL,
      skipped           boolean NOT NULL DEFAULT false,
      -- When it is expected instead, if not on the nominal date.
      expected_date     date,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_recurring_occurrences_item_nominal UNIQUE (recurring_item_id, nominal_date),
      -- Target for the composite keys below.
      CONSTRAINT uq_recurring_occurrences_user_id_id UNIQUE (user_id, id),
      -- A skipped occurrence is not expected on any date.
      CONSTRAINT ck_recurring_occurrences_skipped_not_moved CHECK (NOT (skipped AND expected_date IS NOT NULL)),
      CONSTRAINT fk_recurring_occurrences_recurring_item_id_owned
        FOREIGN KEY (user_id, recurring_item_id) REFERENCES core.recurring_items (user_id, id) ON DELETE CASCADE
    )
  `.execute(db)
  await createIndexIfMissing(db, 'core.ix_recurring_occurrences_user_id', 'ON core.recurring_occurrences (user_id)')
  await ensureRowSecurity(db, 'core.recurring_occurrences', true)
  await ensurePolicy(
    db,
    'core.recurring_occurrences',
    'recurring_occurrences_isolation',
    'user_id = (SELECT core.current_user_id())',
  )

  // ---- per-occurrence leg amounts -----------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS core.recurring_occurrence_legs (
      id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id                 uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      recurring_occurrence_id uuid NOT NULL,
      account_id              uuid NOT NULL,
      amount                  numeric(19,4) NOT NULL,
      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_recurring_occurrence_legs_amount_nonzero CHECK (amount <> 0),
      CONSTRAINT uq_recurring_occurrence_legs_occurrence_account UNIQUE (recurring_occurrence_id, account_id),
      CONSTRAINT fk_recurring_occurrence_legs_recurring_occurrence_id_owned
        FOREIGN KEY (user_id, recurring_occurrence_id)
        REFERENCES core.recurring_occurrences (user_id, id) ON DELETE CASCADE,
      -- CASCADE, unlike the item's legs: an amount for one occurrence is
      -- meaningless without the account, and account delete already decides
      -- what happens to the items themselves.
      CONSTRAINT fk_recurring_occurrence_legs_account_id_owned
        FOREIGN KEY (user_id, account_id) REFERENCES core.accounts (user_id, id) ON DELETE CASCADE
    )
  `.execute(db)
  await createIndexIfMissing(db, 'core.ix_recurring_occurrence_legs_user_id', 'ON core.recurring_occurrence_legs (user_id)')
  // Account merge re-points these by account.
  await createIndexIfMissing(
    db,
    'core.ix_recurring_occurrence_legs_account_id',
    'ON core.recurring_occurrence_legs (account_id)',
  )
  await ensureRowSecurity(db, 'core.recurring_occurrence_legs', true)
  await ensurePolicy(
    db,
    'core.recurring_occurrence_legs',
    'recurring_occurrence_legs_isolation',
    'user_id = (SELECT core.current_user_id())',
  )

  // ---- the link from the ledger -------------------------------------------
  // Nullable with no default: a metadata-only change, no table rewrite.
  await addColumnIfMissing(db, 'core.transactions', 'recurring_occurrence_id', 'uuid')
  // SET NULL on the link column only (PostgreSQL 15+): nulling the whole
  // composite key would also null user_id, which is NOT NULL.
  await addConstraintIfMissing(
    db,
    'core.transactions',
    'fk_transactions_recurring_occurrence_id_owned',
    'FOREIGN KEY (user_id, recurring_occurrence_id) REFERENCES core.recurring_occurrences (user_id, id) ' +
      'ON DELETE SET NULL (recurring_occurrence_id)',
  )
  await createIndexIfMissing(
    db,
    'core.ix_transactions_recurring_occurrence_id',
    'ON core.transactions (recurring_occurrence_id) WHERE recurring_occurrence_id IS NOT NULL',
  )
}

// No `down`, like the other additive migrations: dropping these would
// silently discard every match and override a user has recorded.
