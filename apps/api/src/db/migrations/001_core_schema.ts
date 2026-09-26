import { sql, type Kysely } from 'kysely'
import { createEnumIfMissing } from './support/index.js'

/**
 * Creates the `core` schema, the `uuid-ossp` extension and the enum types.
 *
 * Everything the core owns lives in the `core` schema. Each plugin gets its own
 * `plugin_<id>` schema plus GRANTs on named core tables — that split is what
 * makes a plugin's declared table list enforceable rather than advisory.
 *
 * Safe to re-run: an existing type is left as it is.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db)
  await sql`CREATE SCHEMA IF NOT EXISTS core`.execute(db)

  await createEnumIfMissing(db, 'core.account_type', [
    'checking', 'savings', 'credit_card', 'loan', 'investment',
  ])

  await createEnumIfMissing(db, 'core.user_role', ['owner', 'member'])

  // How a category was assigned. 'manual' is protected from bulk reapply.
  await createEnumIfMissing(db, 'core.category_source', ['manual', 'rule', 'import', 'ai'])

  await createEnumIfMissing(db, 'core.rule_match_type', [
    'merchant_exact', 'merchant_contains', 'description_contains',
  ])

  // A closed enum makes an unknown recurrence frequency unrepresentable, so a
  // recurring item can never silently drop out of a forecast.
  await createEnumIfMissing(db, 'core.recurrence_frequency', [
    'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual',
  ])
}

/**
 * Drops the `core` schema (cascading to everything in it) and the enum types.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS core CASCADE`.execute(db)
  await sql`DROP TYPE IF EXISTS core.recurrence_frequency`.execute(db)
  await sql`DROP TYPE IF EXISTS core.rule_match_type`.execute(db)
  await sql`DROP TYPE IF EXISTS core.category_source`.execute(db)
  await sql`DROP TYPE IF EXISTS core.user_role`.execute(db)
  await sql`DROP TYPE IF EXISTS core.account_type`.execute(db)
}
