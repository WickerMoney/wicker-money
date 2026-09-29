import { sql, type Kysely } from 'kysely'
import {
  addColumnIfMissing,
  addConstraintIfMissing,
  addUniqueConstraintIfMissing,
  columnExists,
  createEnumIfMissing,
  createIndexIfMissing,
  dropConstraintIfExists,
  ensurePolicy,
  ensureRowSecurity,
  inTransaction,
  withOwnerBackfillAccess,
  type Executor,
} from './support/index.js'

/**
 * @module
 * Reshapes `core.recurring_items` into an item (the schedule) plus legs (where
 * the money lands), and gives every item a `kind`.
 *
 * The old shape had one `account_id` and `amount` per item, a nullable
 * `transfer_account_id` for transfers and an `is_income` flag. That cannot
 * express a paycheck split across two accounts, and it stores a transfer as
 * one side plus a pointer, which is the one-sided-transfer shape migration 012
 * already had to undo for transactions. So:
 *
 *  - `core.recurring_item_legs (recurring_item_id, account_id, amount)` holds
 *    one signed amount per account. A bill is one negative leg, income is one
 *    or more positive legs, a transfer or debt payment is two legs netting to
 *    zero. `account_id`, `amount`, `transfer_account_id` and `is_income` leave
 *    the item.
 *  - `kind` (`income | bill | debt_payment | transfer`) is stored on the item,
 *    and a deferred constraint trigger checks at commit that the legs have the
 *    shape the kind requires. It is a trigger rather than a CHECK because the
 *    rule spans rows; it is deferred so an item and its legs can be written in
 *    any order inside one transaction.
 *  - `once` joins the frequency enum, and `semimonthly` items store their two
 *    days (`semimonthly_day_1 < semimonthly_day_2`, the earlier ≤ 27 so they
 *    never land on the same date in February).
 *  - `category_id` gets the composite `(user_id, category_id)` key migration
 *    009 gave every other owned reference; this table was missed there.
 *
 * Existing rows are backfilled (see {@link backfillRecurringItemLegs}); every
 * constraint describing the backfilled state is added after it (lesson #2).
 *
 * Safe to re-run: every step checks before it acts, so a second run on a
 * migrated database changes nothing and takes no blocking lock.
 */

/** Name of the deferred constraint trigger's error, and of the trigger on each table. */
const LEGS_RULE = 'ck_recurring_items_legs_match_kind'

/** Old item columns that move to the legs, in the order they are dropped. */
const OLD_COLUMNS = ['is_income', 'transfer_account_id', 'account_id', 'amount'] as const

/**
 * A `semimonthly` item has both days, ordered, the earlier no later than the
 * 27th (so the two never clamp onto one February date); every other frequency
 * has neither. Every branch tests for NULL explicitly: a CHECK that evaluates
 * to NULL passes, so `semimonthly_day_1 BETWEEN 1 AND 27` alone would wave a
 * missing day through. Exported so the backfill test can re-add it.
 */
export const SEMIMONTHLY_DAYS_CHECK = `CHECK (
  (frequency <> 'semimonthly' AND semimonthly_day_1 IS NULL AND semimonthly_day_2 IS NULL)
  OR (frequency = 'semimonthly'
      AND semimonthly_day_1 IS NOT NULL AND semimonthly_day_2 IS NOT NULL
      AND semimonthly_day_1 BETWEEN 1 AND 27
      AND semimonthly_day_2 > semimonthly_day_1 AND semimonthly_day_2 <= 31)
)`

/**
 * Runs each step in its own statement or transaction: `ALTER TYPE ... ADD
 * VALUE` must commit before anything could use the new label, and the backfill
 * keeps its own transaction so a re-run never sees the column without it.
 */
export const transactional = false

/**
 * Applies the reshape. See the module comment.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ---- enums --------------------------------------------------------------
  await sql`ALTER TYPE core.recurrence_frequency ADD VALUE IF NOT EXISTS 'once' BEFORE 'daily'`.execute(db)
  await createEnumIfMissing(db, 'core.recurring_kind', ['income', 'bill', 'debt_payment', 'transfer'])

  // ---- legs table ---------------------------------------------------------
  // Composite foreign keys need a (user_id, id) key to point at (lesson #8).
  await addUniqueConstraintIfMissing(db, 'core.recurring_items', 'uq_recurring_items_user_id_id', 'user_id, id')

  await sql`
    CREATE TABLE IF NOT EXISTS core.recurring_item_legs (
      id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id           uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      recurring_item_id uuid NOT NULL,
      account_id        uuid NOT NULL,
      amount            numeric(19,4) NOT NULL,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      -- A zero leg moves nothing and would let a "transfer" net to zero with
      -- one side missing.
      CONSTRAINT ck_recurring_item_legs_amount_nonzero CHECK (amount <> 0),
      -- One leg per account: a transfer's two legs are on different accounts,
      -- and a split paycheck has one amount per account.
      CONSTRAINT uq_recurring_item_legs_item_account UNIQUE (recurring_item_id, account_id),
      -- Legs live and die with their item.
      CONSTRAINT fk_recurring_item_legs_recurring_item_id_owned
        FOREIGN KEY (user_id, recurring_item_id) REFERENCES core.recurring_items (user_id, id) ON DELETE CASCADE,
      -- RESTRICT: deleting an account must decide what happens to its items first.
      CONSTRAINT fk_recurring_item_legs_account_id_owned
        FOREIGN KEY (user_id, account_id) REFERENCES core.accounts (user_id, id) ON DELETE RESTRICT
    )
  `.execute(db)
  await createIndexIfMissing(db, 'core.ix_recurring_item_legs_user_id', 'ON core.recurring_item_legs (user_id)')
  // Account delete, merge and usage all look legs up by account.
  await createIndexIfMissing(db, 'core.ix_recurring_item_legs_account_id', 'ON core.recurring_item_legs (account_id)')

  await ensureRowSecurity(db, 'core.recurring_item_legs', true)
  // The scalar-subquery form, as migration 018 rewrote every earlier policy
  // to: a bare call re-verifies the tenant signature for every row scanned.
  // (A bare call here would also be rewritten by 018 on the next reapplyAll,
  // which is how the difference surfaced.)
  await ensurePolicy(
    db,
    'core.recurring_item_legs',
    'recurring_item_legs_isolation',
    'user_id = (SELECT core.current_user_id())',
  )

  // ---- new item columns + backfill ---------------------------------------
  await inTransaction(db, async (trx) => {
    await addColumnIfMissing(trx, 'core.recurring_items', 'semimonthly_day_1', 'smallint')
    await addColumnIfMissing(trx, 'core.recurring_items', 'semimonthly_day_2', 'smallint')
    // Nullable until the backfill has given every row a kind.
    const added = await addColumnIfMissing(trx, 'core.recurring_items', 'kind', 'core.recurring_kind')
    if (added) await backfillRecurringItemLegs(trx)
  })

  if (!(await isNotNull(db, 'core.recurring_items', 'kind'))) {
    await sql`ALTER TABLE core.recurring_items ALTER COLUMN kind SET NOT NULL`.execute(db)
  }
  for (const column of OLD_COLUMNS) {
    // Guarded rather than DROP ... IF EXISTS: that form takes an exclusive
    // lock even when there is nothing to drop.
    if (await columnExists(db, 'core.recurring_items', column)) {
      await sql`ALTER TABLE core.recurring_items DROP COLUMN ${sql.raw(column)}`.execute(db)
    }
  }

  // ---- constraints describing the backfilled state -----------------------
  await addConstraintIfMissing(db, 'core.recurring_items', 'ck_recurring_items_semimonthly_days', SEMIMONTHLY_DAYS_CHECK)

  await addConstraintIfMissing(
    db,
    'core.recurring_items',
    'fk_recurring_items_category_id_owned',
    'FOREIGN KEY (user_id, category_id) REFERENCES core.categories (user_id, id) ON DELETE RESTRICT',
  )
  await dropConstraintIfExists(db, 'core.recurring_items', 'recurring_items_category_id_fkey')

  // ---- leg shape per kind, checked at commit ------------------------------
  await createLegsRule(db)
}

/**
 * Gives every existing item a kind and its legs, and semimonthly items their
 * default days (the 1st and 15th, which is what the old engine assumed).
 *
 * The kind follows the stored sign, which is the convention the seed and the
 * transactions table already use; `is_income` is not consulted, because a
 * flag that disagrees with the sign has no meaning the new model can keep.
 *
 * - `transfer_account_id` set: two legs, `amount` on `account_id` and its
 *   negation on `transfer_account_id`. `debt_payment` when the receiving
 *   account is a card or loan, otherwise `transfer`.
 * - positive amount: `income`, one leg.
 * - negative amount: `bill`, one leg.
 *
 * Rows the new model cannot represent (a zero amount, or a transfer to its own
 * account) fail the migration with their ids rather than being dropped or
 * guessed at.
 *
 * Runs under {@link withOwnerBackfillAccess}: `recurring_items` has FORCE
 * row-level security, which hides every row from the owner (lesson #1).
 * Exported so an integration test can run it against real rows.
 *
 * @param db - Owner connection or transaction; the old columns must still exist.
 * @returns How many items were backfilled.
 * @throws {Error} If any row cannot be represented as legs.
 */
export async function backfillRecurringItemLegs(db: Executor): Promise<number> {
  return withOwnerBackfillAccess(
    db,
    ['core.recurring_items', 'core.recurring_item_legs', 'core.accounts'],
    async (trx) => {
      // Only rows without a kind are unconverted; anything else already has legs.
      const bad = await sql<{ id: string }>`
        SELECT id FROM core.recurring_items
        WHERE kind IS NULL AND (amount = 0 OR transfer_account_id = account_id)
        ORDER BY id
      `.execute(trx)
      if (bad.rows.length > 0) {
        throw new Error(
          `021_recurring_item_legs: ${bad.rows.length} recurring item(s) have a zero amount or transfer to ` +
            `their own account and cannot be converted to legs. Fix or delete them, then re-run: ` +
            bad.rows.map((r) => r.id).join(', '),
        )
      }

      // Legs first, while `kind IS NULL` still marks the rows to convert.
      await sql`
        INSERT INTO core.recurring_item_legs (user_id, recurring_item_id, account_id, amount)
        SELECT user_id, id, account_id, amount FROM core.recurring_items WHERE kind IS NULL
        UNION ALL
        SELECT user_id, id, transfer_account_id, -amount FROM core.recurring_items
         WHERE kind IS NULL AND transfer_account_id IS NOT NULL
        ON CONFLICT (recurring_item_id, account_id) DO NOTHING
      `.execute(trx)

      const updated = await sql`
        UPDATE core.recurring_items r
           SET kind = (CASE
                 WHEN r.transfer_account_id IS NULL AND r.amount > 0 THEN 'income'
                 WHEN r.transfer_account_id IS NULL THEN 'bill'
                 WHEN receiving.account_type IN ('credit_card', 'loan') THEN 'debt_payment'
                 ELSE 'transfer'
               END)::core.recurring_kind,
               semimonthly_day_1 = CASE WHEN r.frequency = 'semimonthly' THEN 1 END,
               semimonthly_day_2 = CASE WHEN r.frequency = 'semimonthly' THEN 15 END
          FROM core.recurring_items src
          LEFT JOIN core.accounts receiving
            ON receiving.id = CASE WHEN src.amount < 0 THEN src.transfer_account_id ELSE src.account_id END
           AND src.transfer_account_id IS NOT NULL
         WHERE src.id = r.id AND r.kind IS NULL
      `.execute(trx)

      return Number(updated.numAffectedRows ?? 0n)
    },
  )
}

/**
 * Creates the function and the two deferred constraint triggers that enforce
 * the leg shape each kind requires:
 *
 * | kind | legs |
 * |---|---|
 * | `income` | one or more, all positive |
 * | `bill` | exactly one, negative |
 * | `transfer`, `debt_payment` | exactly two, one each way, netting to zero |
 *
 * Different accounts, and non-zero amounts, are already guaranteed by the
 * legs table's own constraints. That a `debt_payment` pays a card or loan is
 * checked by the API, not here: account type lives in another table and can
 * change after the fact, so a trigger on legs could not keep it true.
 *
 * Runs as the invoker, so it sees exactly the rows the writer's row-level
 * security allows — which is every leg of that writer's items. An item that
 * no longer exists (deleted in the same transaction, legs cascading) passes.
 *
 * @param db - Migration connection (database owner).
 */
async function createLegsRule(db: Executor): Promise<void> {
  // CREATE OR REPLACE takes no table lock and is a no-op when the body is
  // unchanged, which keeps a re-run invisible to the idempotency snapshot.
  await sql`
    CREATE OR REPLACE FUNCTION core.check_recurring_item_legs() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      item_id uuid;
      item_kind core.recurring_kind;
      legs integer;
      positive integer;
      negative integer;
      total numeric;
      ok boolean;
    BEGIN
      IF TG_TABLE_NAME = 'recurring_items' THEN
        item_id := NEW.id;
      ELSIF TG_OP = 'DELETE' THEN
        item_id := OLD.recurring_item_id;
      ELSE
        item_id := NEW.recurring_item_id;
      END IF;

      SELECT kind INTO item_kind FROM core.recurring_items WHERE id = item_id;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;

      SELECT count(*), count(*) FILTER (WHERE amount > 0), count(*) FILTER (WHERE amount < 0), coalesce(sum(amount), 0)
        INTO legs, positive, negative, total
        FROM core.recurring_item_legs WHERE recurring_item_id = item_id;

      ok := CASE item_kind
        WHEN 'income' THEN legs >= 1 AND negative = 0
        WHEN 'bill' THEN legs = 1 AND negative = 1
        WHEN 'transfer' THEN legs = 2 AND positive = 1 AND negative = 1 AND total = 0
        WHEN 'debt_payment' THEN legs = 2 AND positive = 1 AND negative = 1 AND total = 0
        ELSE false
      END;

      IF NOT ok THEN
        RAISE EXCEPTION 'recurring item % (%) has legs that do not match its kind: % leg(s), % positive, % negative, net %',
          item_id, item_kind, legs, positive, negative, total
          USING ERRCODE = 'check_violation',
                CONSTRAINT = 'ck_recurring_items_legs_match_kind',
                TABLE = 'recurring_items',
                SCHEMA = 'core';
      END IF;
      RETURN NULL;
    END
    $$
  `.execute(db)

  for (const { table, events } of [
    { table: 'recurring_items', events: 'INSERT OR UPDATE OF kind' },
    { table: 'recurring_item_legs', events: 'INSERT OR UPDATE OR DELETE' },
  ]) {
    const { rows } = await sql<{ found: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = ${`core.${table}`}::regclass AND tgname = ${LEGS_RULE}
      ) AS found
    `.execute(db)
    if (rows[0]?.found === true) continue
    await sql`
      CREATE CONSTRAINT TRIGGER ${sql.raw(LEGS_RULE)}
        AFTER ${sql.raw(events)} ON ${sql.raw(`core.${table}`)}
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION core.check_recurring_item_legs()
    `.execute(db)
  }
}

/**
 * Whether a column is already `NOT NULL`, so `SET NOT NULL` (an exclusive lock
 * and a full scan) only runs when it would change something.
 *
 * @param db - Any connection.
 * @param table - Qualified table name.
 * @param column - Column name.
 * @returns `true` if the column exists and is `NOT NULL`.
 */
async function isNotNull(db: Executor, table: string, column: string): Promise<boolean> {
  const { rows } = await sql<{ notnull: boolean }>`
    SELECT attnotnull AS notnull FROM pg_attribute
    WHERE attrelid = to_regclass(${table}) AND attname = ${column} AND NOT attisdropped
  `.execute(db)
  return rows[0]?.notnull === true
}

// No `down`: PostgreSQL cannot drop an enum label ('once'), and folding legs
// back into one account and amount per item loses every split paycheck. A
// `down` that silently discarded data would be worse than one that does not
// exist; `migrate down` on this migration fails loudly instead, as 020 does.
