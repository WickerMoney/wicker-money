import { sql, type Kysely } from 'kysely'
import {
  addConstraintIfMissing,
  createIndexIfMissing,
  ensurePolicy,
  ensureRowSecurity,
} from './support/index.js'

/**
 * @module
 * Account lines: an allowance measured against one account instead of one
 * category. "$150 a month goes into checking to spend on whatever, and the
 * holiday money sits in the same account" is not a category budget, because
 * the money is the account's and the spending is spread over every category.
 *
 * `plugin_budgets.account_lines` has the same per-month-instance shape as
 * `budget_lines` (011), for the same reasons: history survives period
 * boundaries, a carry-forward cannot read a stale figure, and nothing stores
 * what was spent. Spending is derived on read as everything that left the
 * account that month, minus transfers, income, and the categories the line
 * excludes (Holiday Gifts, say, which has a window of its own).
 *
 * Only calendar months. A window (023) is a category idea, a pot spent down
 * between two dates; an allowance repeats every month and carries what is
 * left, so the period is pinned to a month by a CHECK rather than left free.
 *
 * `excluded_category_ids` is an array on the row rather than a child table.
 * It is part of the month's instance, so a later change of mind does not
 * rewrite the months before it, and copying a month copies it for free. The
 * cost is that it has no foreign key: a category deleted later leaves a stale
 * id behind, which matches nothing and is therefore harmless, and the service
 * checks that every id is the caller's own category when it is written.
 *
 * The account reference is a composite `(user_id, account_id)` key, the same
 * ownership pattern as 009 and 011, so a line can never name another user's
 * account. `ON DELETE CASCADE`: a line means nothing without its account, and
 * restricting would make deleting an account fail with a foreign-key error
 * from a schema core does not know exists.
 *
 * Safe to re-run: existing objects are left as they are.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_budgets.account_lines (
      id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id               uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      account_id            uuid NOT NULL,
      -- Inclusive start, exclusive end, as on budget_lines.
      period_start          date NOT NULL,
      period_end            date NOT NULL,
      planned               numeric(19,4) NOT NULL,
      -- On by default, unlike a category line: an allowance you did not spend
      -- is the point of having one.
      rollover              boolean NOT NULL DEFAULT true,
      excluded_category_ids uuid[] NOT NULL DEFAULT '{}',
      note                  varchar(300),
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT ck_account_lines_month CHECK (
        EXTRACT(DAY FROM period_start) = 1
        AND period_end = (period_start + interval '1 month')::date
      ),
      CONSTRAINT ck_account_lines_planned CHECK (planned >= 0),
      CONSTRAINT ck_account_lines_excluded_size CHECK (cardinality(excluded_category_ids) <= 50)
    )
  `.execute(db)

  // One line per account per month; also the arbiter for the upsert.
  await createIndexIfMissing(
    db,
    'plugin_budgets.ux_account_lines_user_account_period',
    'ON plugin_budgets.account_lines (user_id, account_id, period_start)',
    { unique: true },
  )
  await createIndexIfMissing(
    db,
    'plugin_budgets.ix_account_lines_user_period',
    'ON plugin_budgets.account_lines (user_id, period_start)',
  )

  await addConstraintIfMissing(
    db,
    'plugin_budgets.account_lines',
    'fk_account_lines_account_owned',
    'FOREIGN KEY (user_id, account_id) REFERENCES core.accounts (user_id, id) ON DELETE CASCADE',
  )

  await ensureRowSecurity(db, 'plugin_budgets.account_lines', true)
  await ensurePolicy(
    db,
    'plugin_budgets.account_lines',
    'account_lines_isolation',
    'user_id = core.current_user_id()',
  )
}

/**
 * Drops the table and the account lines in it.
 *
 * Unlike the additive migrations this one has a `down`: it is a feature being
 * tried out, and backing it out should leave the database exactly as 026 left
 * it. Nothing else references the table.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS plugin_budgets.account_lines`.execute(db)
}
