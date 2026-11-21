import { sql, type Kysely } from 'kysely'
import { withOwnerBackfillAccess } from './support/index.js'

/**
 * @module
 * Lets the debt payoff plugin save the strategy `custom` (the person's own
 * order) in `plugin_debt_payoff.plan_settings.strategy`.
 *
 * The order itself needs no new column. `plugin_debt_payoff.debts.sort_order`
 * has existed since migration 030 as `integer NOT NULL DEFAULT 0`, with an
 * index that leads with it, and the plugin has always listed debts by it
 * (then oldest first, then id), so every existing debt already has a place in
 * the person's list and the order they see today is the order Custom order
 * starts from. There is nothing to backfill and no unique constraint is added:
 * a new debt takes the next number, an explicit `sortOrder` may repeat one
 * (the tie-break is `created_at`, then `id`), and the reorder route writes
 * `0..n-1` for every active debt in one statement.
 *
 * All that was in the way is `ck_plan_settings_strategy`, which listed the two
 * strategies that existed in 030 (030 chose a CHECK over an enum so that adding
 * one would be a constraint swap). The swap is one `ALTER TABLE`, so there is no
 * moment without a check, and it validates against `plan_settings`, which has
 * at most one row per person. Every existing row is `snowball` or `avalanche`
 * and stays so: nobody has Custom order until they choose it, and the plan they
 * get is the one they had.
 *
 * Row-level security is untouched: it is a constraint on a table whose policy
 * already filters by `user_id`.
 *
 * The swap takes a short exclusive lock on `plan_settings` while it validates,
 * which is a handful of rows (one per person). A re-run finds `custom` already
 * allowed and issues no statement at all, so it takes no lock, as every
 * migration here must (`migrations.idempotent.integration.test.ts`).
 */

const TABLE = 'plugin_debt_payoff.plan_settings'
const CHECK = 'ck_plan_settings_strategy'

/**
 * Widens the strategy check to include `custom`.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const current = await sql<{ def: string }>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = to_regclass(${TABLE}) AND conname = ${CHECK} AND convalidated
  `.execute(db)
  if (current.rows[0]?.def.includes("'custom'") === true) return
  await sql`
    ALTER TABLE ${sql.raw(TABLE)}
      DROP CONSTRAINT IF EXISTS ${sql.raw(CHECK)},
      ADD CONSTRAINT ${sql.raw(CHECK)} CHECK (strategy IN ('snowball', 'avalanche', 'custom'))
  `.execute(db)
}

/**
 * Narrows the check back to the two earlier strategies. A person who had
 * chosen Custom order is moved to `avalanche`, the default, which is what the
 * old version would have shown them; their debts, their order and their extra
 * amount are kept.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  // plan_settings has FORCE row-level security, so the owner needs the
  // transient backfill policy for the UPDATE to see any row.
  await withOwnerBackfillAccess(db, [TABLE], async (trx) => {
    await sql`UPDATE ${sql.raw(TABLE)} SET strategy = 'avalanche', updated_at = now() WHERE strategy = 'custom'`.execute(trx)
    await sql`
      ALTER TABLE ${sql.raw(TABLE)}
        DROP CONSTRAINT IF EXISTS ${sql.raw(CHECK)},
        ADD CONSTRAINT ${sql.raw(CHECK)} CHECK (strategy IN ('snowball', 'avalanche'))
    `.execute(trx)
  })
}
