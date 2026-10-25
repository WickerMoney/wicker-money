import { sql, type Kysely } from 'kysely'
import { addColumnIfMissing, addConstraintIfMissing } from './support/index.js'

/**
 * @module
 * Two per-debt plan controls on `plugin_debt_payoff.debts`.
 *
 * - `included`: whether the debt is part of the payoff plan. A debt that is
 *   switched off stays in the person's list but is left out of the plan, its
 *   totals and the debt-free date (a mortgage that would otherwise dwarf every
 *   other balance, say). It is not `archived`: archived means paid off or
 *   retired, hides the debt from the list, and frees an active slot.
 *   Everything that exists today stays in the plan (`DEFAULT true`).
 * - `extra_payment`: an amount paid toward this debt every month on top of its
 *   minimum and outside the shared extra in `plan_settings`. Money, so
 *   `numeric(19,4)` like every other amount, never negative. Zero (the
 *   default) means no earmark, which is every existing debt's plan unchanged.
 *
 * Both are constant defaults, so adding them is a metadata-only change with no
 * table rewrite, and row-level security is untouched: they are columns on a
 * table whose policy already filters by `user_id`.
 *
 * Safe to re-run: columns and the constraint are added only if missing.
 */

const TABLE = 'plugin_debt_payoff.debts'

/**
 * Adds the two columns and the non-negative check.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addColumnIfMissing(db, TABLE, 'included', 'boolean NOT NULL DEFAULT true')
  await addColumnIfMissing(db, TABLE, 'extra_payment', 'numeric(19,4) NOT NULL DEFAULT 0')
  await addConstraintIfMissing(db, TABLE, 'ck_debts_extra_payment', 'CHECK (extra_payment >= 0)')
}

/**
 * Drops both columns, which discards every person's "in plan" switches and
 * earmarks; the debts themselves are kept. The check constraint goes with its
 * column.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE plugin_debt_payoff.debts DROP COLUMN IF EXISTS extra_payment`.execute(db)
  await sql`ALTER TABLE plugin_debt_payoff.debts DROP COLUMN IF EXISTS included`.execute(db)
}
