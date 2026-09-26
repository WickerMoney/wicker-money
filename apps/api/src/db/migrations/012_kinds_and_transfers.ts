import { sql, type Kysely } from 'kysely'
import {
  addColumnIfMissing,
  addConstraintIfMissing,
  constraintState,
  createEnumIfMissing,
  createIndexIfMissing,
  inTransaction,
  withOwnerBackfillAccess,
} from './support/index.js'

/** Name of the constraint requiring a transfer leg to carry both its id and its counterpart. */
const TRANSFER_CONSTRAINT = 'ck_transactions_transfer_complete'

/**
 * Distinguishes money moving between accounts from money arriving or leaving,
 * by adding `core.categories.kind` and modelling transfers as two linked legs.
 *
 * A transfer with a single row would show as money leaving one account that
 * never arrives anywhere: balances (which sum `core.transactions` per account)
 * would be short on the receiving side and spending totals would count the
 * transfer as spending. So each transfer is now two rows, one per account,
 * with opposite signs, sharing a `transfer_id`.
 *
 * Categories gain a `kind` (`expense`, `income` or `transfer`) because income
 * cannot be inferred from the sign of the amount: a refund is a positive amount
 * against an expense category.
 *
 * Existing one-sided transfers are backfilled with their missing leg, and
 * existing categories under the `income` slug are marked as income.
 *
 * Safe to re-run, and it keeps its exclusive locks short on an existing ledger
 * (only the backfill transactions exclude readers, and only while they run):
 *
 *  - Categories are backfilled only in the run that adds `kind`, so a later run
 *    never undoes a kind the user has since changed.
 *  - The transfer backfill runs only while the completeness constraint is
 *    absent or unvalidated. Once that constraint holds, no one-sided transfer
 *    can exist, so there is nothing left to backfill.
 *  - The constraint is added `NOT VALID` and validated afterwards, so the scan
 *    that checks existing rows does not block reads or writes.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ---- categories gain a kind ---------------------------------------------
  await createEnumIfMissing(db, 'core.category_kind', ['expense', 'income', 'transfer'])

  // The column and its backfill share a transaction, so a re-run cannot see
  // the column without the backfill having happened.
  await inTransaction(db, async (trx) => {
    const added = await addColumnIfMissing(
      trx,
      'core.categories',
      'kind',
      "core.category_kind NOT NULL DEFAULT 'expense'",
    )
    if (added) await backfillCategoryKinds(trx)
  })

  // ---- transfers become two linked legs -----------------------------------
  await addColumnIfMissing(db, 'core.transactions', 'transfer_id', 'uuid')

  await createIndexIfMissing(
    db,
    'core.ix_transactions_transfer_id',
    'ON core.transactions (transfer_id) WHERE transfer_id IS NOT NULL',
  )

  if ((await constraintState(db, 'core.transactions', TRANSFER_CONSTRAINT)) !== 'valid') {
    await backfillTransferLegs(db)
  }

  /**
   * A transfer leg is a transfer on both counts or neither.
   *
   * Added *after* the backfill, not before: every pre-existing transfer row carries a
   * `transfer_account_id` and no `transfer_id`, so declaring the rule first
   * makes the migration fail on its own data. The constraint describes the
   * state the backfill produces, so it is asserted once that state exists —
   * which also means it validates the backfill rather than merely following it.
   *
   * Without it a row could carry a `transfer_id` and no counterparty, which
   * reads as half a transfer: excluded from spending while belonging to no pair.
   */
  await addConstraintIfMissing(
    db,
    'core.transactions',
    TRANSFER_CONSTRAINT,
    'CHECK ((transfer_id IS NULL) = (transfer_account_id IS NULL))',
  )
}

/**
 * Tells the migrator to run this migration without wrapping it in a
 * transaction, so the constraint scan and the backfills hold their locks only
 * for their own statements. Every step is idempotent.
 */
export const transactional = false

/**
 * Gives every existing one-sided transfer the leg it never had.
 *
 * `core.transactions` runs with FORCE row-level security, so the owner running
 * this migration (with no tenant context) cannot see a single row through it;
 * a temporary owner-only policy admits it for the duration of one transaction.
 *
 * The new leg mirrors the old one: same date, same user, opposite sign,
 * pointing back at the account the money came from. `user_id` is carried
 * across rather than looked up, which keeps the composite ownership foreign
 * keys on `core.transactions` satisfied.
 *
 * Both statements are set-based and only touch rows still missing a
 * `transfer_id`, so running it again finds nothing to do.
 *
 * Exported so a test can run it against real data.
 *
 * @param db - Migration connection (database owner) or an open transaction.
 */
export async function backfillTransferLegs(db: Kysely<unknown>): Promise<void> {
  await withOwnerBackfillAccess(db, ['core.transactions'], async (trx) => {
    // Pair up what is already there first: a transfer whose mirror image
    // happens to exist gets linked rather than duplicated.
    await sql`
      WITH pairs AS (
        SELECT a.id AS a_id, b.id AS b_id, uuid_generate_v4() AS tid
        FROM core.transactions a
        JOIN core.transactions b
          ON b.user_id = a.user_id
         AND b.account_id = a.transfer_account_id
         AND b.transfer_account_id = a.account_id
         AND b.transaction_date = a.transaction_date
         AND b.amount = -a.amount
         AND b.transfer_id IS NULL
        WHERE a.transfer_account_id IS NOT NULL
          AND a.transfer_id IS NULL
          AND a.id < b.id
      )
      UPDATE core.transactions t
        SET transfer_id = p.tid
      FROM pairs p
      WHERE t.id IN (p.a_id, p.b_id)
    `.execute(trx)

    // Whatever is still unpaired was genuinely one-sided; give it a partner.
    await sql`
      WITH lonely AS (
        SELECT id, user_id, account_id, transfer_account_id, amount, merchant,
               transaction_date, notes, uuid_generate_v4() AS tid
        FROM core.transactions
        WHERE transfer_account_id IS NOT NULL AND transfer_id IS NULL
      ),
      tagged AS (
        UPDATE core.transactions t
          SET transfer_id = l.tid
        FROM lonely l
        WHERE t.id = l.id
        RETURNING t.id
      )
      INSERT INTO core.transactions
        (user_id, account_id, amount, merchant, transaction_date, notes,
         transfer_account_id, transfer_id)
      SELECT l.user_id, l.transfer_account_id, -l.amount, l.merchant,
             l.transaction_date, l.notes, l.account_id, l.tid
      FROM lonely l
      WHERE EXISTS (SELECT 1 FROM tagged WHERE tagged.id = l.id)
    `.execute(trx)
  })
}

/**
 * Marks the `income` category and its direct children as `kind = 'income'`.
 *
 * Matches by slug, because a slug is stable across renames. A user's own
 * hand-made income category keeps the default `expense` kind and can be
 * switched by the user — guessing from a name would be wrong more often than
 * right.
 *
 * The UPDATE runs under a temporary owner-only policy, because the owner
 * running migrations has no tenant context and `core.categories` has FORCE
 * row-level security: without it the UPDATE would see no rows and would
 * succeed while changing nothing. An UPDATE that matches zero rows is not an
 * error.
 *
 * Exported so a test can run it against real data.
 *
 * @param db - Migration connection (database owner) or an open transaction.
 */
export async function backfillCategoryKinds(db: Kysely<unknown>): Promise<void> {
  await withOwnerBackfillAccess(db, ['core.categories'], async (trx) => {
    await sql`
      UPDATE core.categories c
        SET kind = 'income'
      WHERE c.kind = 'expense'
        AND (
          c.slug = 'income'
          OR c.parent_id IN (SELECT id FROM core.categories WHERE slug = 'income')
        )
    `.execute(trx)
  })
}

/**
 * Drops the transfer constraint, index and `transfer_id` column, the
 * `kind` column and the `core.category_kind` type. Transfer legs created by
 * the backfill are left in place.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE core.transactions
      DROP CONSTRAINT IF EXISTS ck_transactions_transfer_complete
  `.execute(db)
  await sql`DROP INDEX IF EXISTS core.ix_transactions_transfer_id`.execute(db)
  await sql`ALTER TABLE core.transactions DROP COLUMN IF EXISTS transfer_id`.execute(db)
  await sql`ALTER TABLE core.categories DROP COLUMN IF EXISTS kind`.execute(db)
  await sql`DROP TYPE IF EXISTS core.category_kind`.execute(db)
}
