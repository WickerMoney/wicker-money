import { sql, type Kysely } from 'kysely'
import { addColumnIfMissing, inTransaction, withOwnerBackfillAccess } from './support/index.js'

/**
 * Adds `core.users.onboarded_at` and `core.users.onboarding_situations` to
 * remember whether a user has been through first-run setup, and backfills
 * existing users.
 *
 * Two columns rather than one flag, because the answers are worth keeping after
 * the wizard closes:
 *
 * `onboarded_at` is what decides whether the modal opens. NULL means never
 * finished — including "started and closed the tab", which is the same thing
 * from the user's point of view and should show the wizard again.
 *
 * `onboarding_situations` is what they said applies to them. The starter
 * categories it produced are ordinary rows afterwards, editable and deletable,
 * so the created set is not a record of the answers. Keeping the answers lets a
 * later question ("you said you have pets — add the pet categories?") be asked
 * without making the user re-declare their whole life, and lets the Categories
 * page show what setup was based on.
 *
 * `text[]` rather than an enum array on purpose: the situation list is
 * application vocabulary that will keep changing, and a migration per new
 * question would be a tax on asking better ones. Nothing in the database
 * branches on the value, so an unrecognised entry is inert rather than broken —
 * the API filters to known situations when it reads them back.
 *
 * Safe to re-run. Existing users are backfilled only in the run that adds
 * `onboarded_at`: on a later run a NULL there can mean a user who is part-way
 * through the wizard, and marking them would skip it.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // One short transaction, so the column and its backfill either both happen
  // or neither does; a re-run could not tell a missed backfill from a user
  // still to be onboarded.
  await inTransaction(db, async (trx) => {
    const added = await addColumnIfMissing(trx, 'core.users', 'onboarded_at', 'timestamptz')
    await addColumnIfMissing(
      trx,
      'core.users',
      'onboarding_situations',
      "text[] NOT NULL DEFAULT '{}'",
    )
    if (added) await backfillOnboarded(trx)
  })
}

/**
 * Tells the migrator to run this migration without wrapping it in a
 * transaction; the steps that need to be atomic open their own short one.
 */
export const transactional = false

/**
 * Marks accounts that were evidently already past setup.
 *
 * Existing users have been running the app for a while; dropping them into a
 * wizard on next login would be a regression dressed as a feature. Having any
 * category at all is the evidence — setup is the only thing that creates them
 * in bulk, and someone who made even one by hand has plainly found the screen.
 *
 * Reading `core.categories` needs a temporary owner-only policy, because the
 * table runs with FORCE row-level security, which — unlike plain ENABLE —
 * applies to the table's owner too, and migrations run *as* that owner with no
 * tenant context. Without it, `EXISTS (SELECT 1 FROM core.categories ...)`
 * matches nothing, for every user: the statement would succeed and mark
 * nobody. `SET LOCAL row_security = off` is refused for a role that cannot
 * bypass RLS, and FORCE is exactly what removes that ability.
 *
 * Exported so a test can run it against real data.
 *
 * @param db - Migration connection (database owner) or an open transaction.
 */
export async function backfillOnboarded(db: Kysely<unknown>): Promise<void> {
  await withOwnerBackfillAccess(db, ['core.categories'], async (trx) => {
    // One set-based statement; the users table is small and the write is a
    // single timestamp per row.
    await sql`
      UPDATE core.users u
        SET onboarded_at = now()
      WHERE u.onboarded_at IS NULL
        AND EXISTS (SELECT 1 FROM core.categories c WHERE c.user_id = u.id)
    `.execute(trx)
  })
}

/**
 * Drops the onboarding columns from `core.users`.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE core.users
      DROP COLUMN IF EXISTS onboarding_situations,
      DROP COLUMN IF EXISTS onboarded_at
  `.execute(db)
}
