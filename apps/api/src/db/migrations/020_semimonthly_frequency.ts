import { sql, type Kysely } from 'kysely'

/**
 * @module
 * Adds `semimonthly` to `core.recurrence_frequency`.
 *
 * A separate migration, not an edit to 001_core_schema.ts: Kysely tracks
 * applied migrations by name in `kysely_migration`, so an already-migrated
 * database would never re-run 001's body no matter what it says. Only a
 * new, pending migration reaches an existing instance.
 *
 * `ADD VALUE IF NOT EXISTS` makes this idempotent, which `reapplyAll`
 * (re-runs every migration's `up`) requires. PostgreSQL 12+ allows
 * `ALTER TYPE ... ADD VALUE` inside a transaction (each migration already
 * runs in its own, per TransactionalMigrationProvider); the remaining
 * restriction — the new label can't be *used* in the same transaction
 * that added it — doesn't apply here, since this migration only adds the
 * label.
 *
 * Positioned `AFTER 'biweekly'` for a readable declaration order (daily,
 * weekly, biweekly, semimonthly, monthly, quarterly, annual); nothing in
 * the codebase orders or compares on this enum today, so this is
 * cosmetic, not load-bearing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TYPE core.recurrence_frequency
      ADD VALUE IF NOT EXISTS 'semimonthly' AFTER 'biweekly'
  `.execute(db)
}

// No `down`: PostgreSQL has no `ALTER TYPE ... DROP VALUE`. Reverting
// would mean rebuilding the enum type from scratch and deciding what
// happens to any row already using 'semimonthly' — out of scope for a
// migration that only adds a label. `down` is optional on Kysely's
// `Migration` type; omitting it means `migrate down` on this one fails
// loudly instead of silently pretending to revert.
