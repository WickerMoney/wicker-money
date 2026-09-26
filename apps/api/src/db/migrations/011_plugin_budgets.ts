import { sql, type Kysely } from 'kysely'
import {
  addConstraintIfMissing,
  createIndexIfMissing,
  ensurePolicy,
  ensureRowSecurity,
} from './support/index.js'

/**
 * Creates the `plugin_budgets` schema with `budget_lines`: budgets modelled as
 * per-period instances rather than a mutable template.
 *
 * One row per category per period, each owning its own planned amount. That
 * shape has three consequences:
 *
 *  - **History survives period boundaries.** Rolling over creates a new row
 *    instead of overwriting one, so "what did we plan for March and what did
 *    we actually spend" stays answerable.
 *  - **Carry-forward cannot read a stale figure.** No instance shares mutable
 *    state with any other, so a later refresh cannot recompute the number a
 *    carry-forward should have used.
 *  - **There is no stored `spent` column.** Actuals are derived on read from
 *    the ledger, the only place they are ever true, so there is exactly one
 *    source of truth.
 *
 * `period_start` / `period_end` are stored explicitly rather than as a month
 * key. The period is the calendar month today, but a different cadence later
 * is then a change of what gets written, not a migration of what was. The
 * table has row-level security keyed on `user_id`.
 *
 * Safe to re-run: existing objects are left as they are.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS plugin_budgets`.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS plugin_budgets.budget_lines (
      id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id       uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      category_id   uuid NOT NULL,
      -- Inclusive start, exclusive end. Half-open avoids the off-by-one that
      -- "last day of the month" invites, and makes the spend predicate a plain
      -- >= / < pair, so a transaction dated after the period ends is never
      -- counted against it.
      period_start  date NOT NULL,
      period_end    date NOT NULL,
      planned       numeric(19,4) NOT NULL,
      /**
       * Whether this line's unspent balance carries into the next period.
       *
       * Per line, not per instance and not a global setting. Car maintenance is
       * a sinking fund and should accumulate; groceries is a monthly allowance
       * and should not. A single toggle would be wrong for half of anyone's
       * categories.
       */
      rollover      boolean NOT NULL DEFAULT false,
      note          varchar(300),
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT ck_budget_lines_period CHECK (period_end > period_start),
      -- A budget line is a plan, and a negative plan is not one. Zero is
      -- allowed and meaningful: "this category is deliberately budgeted at
      -- nothing" is different from having no line at all.
      CONSTRAINT ck_budget_lines_planned CHECK (planned >= 0)
    )
  `.execute(db)

  // One line per category per period. Without this, two lines for Groceries in
  // March both look authoritative and every total is quietly wrong.
  await createIndexIfMissing(
    db,
    'plugin_budgets.ux_budget_lines_user_category_period',
    'ON plugin_budgets.budget_lines (user_id, category_id, period_start)',
    { unique: true },
  )
  await createIndexIfMissing(
    db,
    'plugin_budgets.ix_budget_lines_user_period',
    'ON plugin_budgets.budget_lines (user_id, period_start)',
  )

  /**
   * Composite foreign key on `(user_id, category_id)`, the same ownership
   * pattern used between core tables.
   *
   * PostgreSQL evaluates a foreign key with the referenced table's privileges
   * and deliberately bypasses row-level security while doing so. A plain
   * `REFERENCES core.categories(id)` would therefore let one user's budget line
   * point at another user's category — invisible to its supposed owner, real in
   * the database, and surfacing in any query that joined the two. `(user_id,
   * category_id)` against `core.categories (user_id, id)` closes it for every
   * writer, including this plugin, with no application check to remember.
   *
   * ON DELETE RESTRICT: deleting a category you have budgeted against should
   * ask a question, not silently orphan a plan.
   */
  await addConstraintIfMissing(
    db,
    'plugin_budgets.budget_lines',
    'fk_budget_lines_category_owned',
    'FOREIGN KEY (user_id, category_id) REFERENCES core.categories (user_id, id) ON DELETE RESTRICT',
  )

  // Same isolation rule as core and as the importer's schema: a plugin's tables
  // carry user data, so a plugin bug must not become a cross-user leak. FORCE
  // applies — no SECURITY DEFINER function touches this table, so nothing needs
  // the owner exemption that `core.users` and `core.sessions` need.
  await ensureRowSecurity(db, 'plugin_budgets.budget_lines', true)
  await ensurePolicy(
    db,
    'plugin_budgets.budget_lines',
    'budget_lines_isolation',
    'user_id = core.current_user_id()',
  )
}

/**
 * Drops the `plugin_budgets` schema and everything in it.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS plugin_budgets CASCADE`.execute(db)
}
