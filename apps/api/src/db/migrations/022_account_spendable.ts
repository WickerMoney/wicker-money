import { sql, type Kysely } from 'kysely'
import {
  addColumnIfMissing,
  addConstraintIfMissing,
  inTransaction,
  withOwnerBackfillAccess,
  type Executor,
} from './support/index.js'

/**
 * @module
 * Adds `core.accounts.spendable`: whether the money in an account counts as
 * available for everyday spending.
 *
 * The "Until payday" widget used to count every checking account toward safe
 * to spend. That is wrong for a household that keeps a second checking
 * account for yearly bills, or anyone who treats a large balance as savings
 * they do not want to see as spendable. The choice belongs to the account,
 * beside its buffer, rather than to one widget, so a later forecast page or
 * plugin reads the same answer.
 *
 * - Checking accounts start spendable (what the widget assumed until now);
 *   everything else starts not spendable.
 * - Only checking and savings can be spendable. A card's or loan's balance is
 *   debt, and counting available credit as safe to spend is the mistake a
 *   budgeting app must not make. A CHECK holds that, added after the
 *   backfill (lesson #2).
 *
 * Safe to re-run: the backfill only runs in the transaction that adds the
 * column, so a second run never resets a user's choice, and nothing takes a
 * blocking lock once the column and constraint exist.
 */

/** Account types that may be spendable. The API and the CHECK agree on this list. */
export const SPENDABLE_CHECK = `CHECK (NOT spendable OR account_type IN ('checking', 'savings'))`

/**
 * Applies the change. See the module comment.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await inTransaction(db, async (trx) => {
    // A constant default is a metadata-only change: no table rewrite.
    const added = await addColumnIfMissing(trx, 'core.accounts', 'spendable', 'boolean NOT NULL DEFAULT false')
    if (added) await backfillSpendable(trx)
  })
  await addConstraintIfMissing(db, 'core.accounts', 'ck_accounts_spendable_type', SPENDABLE_CHECK)
}

/**
 * Marks every existing checking account spendable, which is what "Until
 * payday" assumed before the column existed, so nobody's number changes on
 * upgrade.
 *
 * Runs under {@link withOwnerBackfillAccess}: `accounts` has FORCE row-level
 * security, which hides every row from the owner (lesson #1). Exported so an
 * integration test can run it against real rows.
 *
 * @param db - Owner connection or transaction; the column must exist.
 * @returns How many accounts were marked.
 */
export async function backfillSpendable(db: Executor): Promise<number> {
  return withOwnerBackfillAccess(db, ['core.accounts'], async (trx) => {
    const result = await sql`
      UPDATE core.accounts SET spendable = true WHERE account_type = 'checking' AND NOT spendable
    `.execute(trx)
    return Number(result.numAffectedRows ?? 0n)
  })
}

// No `down`, like the other additive migrations: dropping the column would
// silently discard every user's choice.
