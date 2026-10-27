import { sql, type Kysely } from 'kysely'
import { addColumnIfMissing, addConstraintIfMissing } from './support/index.js'

/**
 * @module
 * Per-debt timeline and interest options on `plugin_debt_payoff.debts`.
 *
 * - `repayment_starts_on`: for a loan in deferment, the day repayment begins.
 *   `NULL` means it has begun (every existing debt).
 * - `promo_apr` and `promo_ends_on`: a promotional rate and its last day, set
 *   together or not at all. `NULL` means none (every existing debt).
 * - `promo_deferred_interest`: whether interest is charged back to the start if
 *   the balance is not cleared by `promo_ends_on`. Needs a promotion.
 * - `promo_interest_base`: what that interest is charged on, `original` or
 *   `declining`.
 * - `compounding`: how interest is worked out, `monthly` (what every existing
 *   debt used), `daily` or `daily_simple`.
 *
 * Every column is nullable or has a constant default, so adding them is a
 * metadata-only change with no table rewrite, and every existing debt's plan
 * is exactly what it was. Row-level security is untouched: these are columns
 * on a table whose policy already filters by `user_id`.
 *
 * Safe to re-run: columns and constraints are added only if missing.
 */

const TABLE = 'plugin_debt_payoff.debts'

/**
 * Adds the six columns and their checks.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addColumnIfMissing(db, TABLE, 'repayment_starts_on', 'date')
  await addColumnIfMissing(db, TABLE, 'promo_apr', 'numeric(7,4)')
  await addColumnIfMissing(db, TABLE, 'promo_ends_on', 'date')
  await addColumnIfMissing(db, TABLE, 'promo_deferred_interest', 'boolean NOT NULL DEFAULT false')
  await addColumnIfMissing(db, TABLE, 'promo_interest_base', "text NOT NULL DEFAULT 'original'")
  await addColumnIfMissing(db, TABLE, 'compounding', "text NOT NULL DEFAULT 'monthly'")
  await addConstraintIfMissing(db, TABLE, 'ck_debts_promo_apr', 'CHECK (promo_apr IS NULL OR promo_apr >= 0)')
  await addConstraintIfMissing(db, TABLE, 'ck_debts_promo_pair', 'CHECK ((promo_apr IS NULL) = (promo_ends_on IS NULL))')
  await addConstraintIfMissing(
    db, TABLE, 'ck_debts_promo_deferred', 'CHECK (NOT promo_deferred_interest OR promo_apr IS NOT NULL)',
  )
  await addConstraintIfMissing(
    db, TABLE, 'ck_debts_promo_base', "CHECK (promo_interest_base IN ('original', 'declining'))",
  )
  await addConstraintIfMissing(
    db, TABLE, 'ck_debts_compounding', "CHECK (compounding IN ('monthly', 'daily', 'daily_simple'))",
  )
}

/**
 * Drops the six columns, which discards every person's repayment dates,
 * promotions and compounding choices; the debts themselves are kept. The
 * checks go with their columns.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const column of [
    'compounding', 'promo_interest_base', 'promo_deferred_interest', 'promo_ends_on', 'promo_apr', 'repayment_starts_on',
  ]) {
    await sql.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${column}`).execute(db)
  }
}
