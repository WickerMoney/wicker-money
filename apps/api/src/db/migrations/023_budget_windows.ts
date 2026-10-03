import { sql, type Kysely } from 'kysely'
import { constraintState, dropConstraintIfExists, withOwnerBackfillAccess } from './support/index.js'

/**
 * @module
 * Lets a budget line span more than one calendar month: a "window" such as
 * holiday gifts from October 1 through December 25, funded once and spent down
 * to zero.
 *
 * No new column. Migration 011 stored `period_start` / `period_end` explicitly
 * so that "a different cadence later is a change of what gets written, not a
 * migration of what was", and that is exactly what this is. A line covering
 * exactly one calendar month is a monthly line, and any other period is a
 * window. The plugin derives that from the dates, so no flag can disagree with
 * them.
 *
 * What does need the schema is preventing overlap. The unique index on
 * `(user_id, category_id, period_start)` only stops two lines from starting on
 * the same day. A window from October 1 to December 26 and a monthly November
 * line start on different days, and both would count November's spending, so
 * every total would quietly include it twice. An exclusion constraint over the
 * date range enforces the actual rule: one line per category per day. It needs
 * `btree_gist` to compare the uuid columns with `=` inside a GiST index.
 * `btree_gist` is a trusted extension, so the database owner that runs
 * migrations can create it without being a superuser.
 *
 * The unique index stays. `ON CONFLICT (user_id, category_id, period_start)`
 * in the monthly upsert needs it as its arbiter, and an exclusion constraint
 * cannot serve as one for `DO UPDATE`.
 *
 * Exclusion constraints cannot be added `NOT VALID`, so the first run builds
 * the index under an exclusive lock. `budget_lines` holds a few rows per user
 * per month, so that takes milliseconds. A re-run finds the constraint and
 * issues no statement that locks the table.
 */

/** The overlap rule. Half-open `daterange` matches the half-open period columns. */
export const NO_OVERLAP = `EXCLUDE USING gist (
  user_id WITH =,
  category_id WITH =,
  daterange(period_start, period_end) WITH &&
)`

const TABLE = 'plugin_budgets.budget_lines'
const CONSTRAINT = 'ex_budget_lines_no_overlap'

/**
 * Applies the change. See the module comment.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`.execute(db)
  if ((await constraintState(db, TABLE, CONSTRAINT)) !== 'missing') return
  await sql`ALTER TABLE ${sql.raw(TABLE)} ADD CONSTRAINT ${sql.raw(CONSTRAINT)} ${sql.raw(NO_OVERLAP)}`.execute(db)
}

/**
 * Removes windows and the overlap rule, leaving only monthly lines.
 *
 * Unlike the additive migrations this one has a `down`: windows are a feature
 * being tried out, and backing it out should leave the database exactly as 022
 * left it. Every line that is not exactly one calendar month is deleted. Those
 * are the windows, and the month queries from before this migration would
 * misread them. `btree_gist` is left installed because removing an extension
 * is never needed and it may have other users.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await withOwnerBackfillAccess(db, [TABLE], async (trx) => {
    await sql`
      DELETE FROM ${sql.raw(TABLE)}
      WHERE NOT (
        period_start = date_trunc('month', period_start)::date
        AND period_end = (period_start + interval '1 month')::date
      )
    `.execute(trx)
  })
  await dropConstraintIfExists(db, TABLE, CONSTRAINT)
}
