import { sql, type Kysely } from 'kysely'
import {
  addConstraintIfMissing,
  addUniqueConstraintIfMissing,
  createIndexIfMissing,
  dropConstraintIfExists,
  ensurePolicy,
  ensureRowSecurity,
} from './support/index.js'

/**
 * @module
 * Lump sums for the debt payoff plugin: one-off payments (a bonus, a tax
 * refund) the plan applies on their dates, in the plugin's own schema.
 *
 * - `lump_sums`: one row per lump sum, `id, user_id, on_date, amount, note`.
 *   The amount is `numeric(19,4)` like every other amount and is greater than
 *   zero; it is never a `number` in TypeScript. `on_date` is a calendar date
 *   (the plan pays it on the first payment date on or after it).
 * - `lump_sum_allocations`: optional parts of a lump sum aimed at one debt,
 *   `lump_sum_id, user_id, debt_id, amount`. Whatever is not allocated follows
 *   the strategy, so a lump sum with no rows here is "by the strategy". A debt
 *   appears at most once per lump sum (the primary key). That the parts of a
 *   lump sum do not add up to more than its amount is a rule across rows, which
 *   a CHECK cannot state; the plugin's service enforces it in the same
 *   transaction as the write.
 *
 * Nothing derived is stored: whether a lump sum is in the past, and what it
 * saves, are worked out on every read from these rows and the debts.
 *
 * **Ownership.** Both tables carry `user_id`, have row-level security
 * *forced*, and use the policy shape every table since migration 018 uses
 * (`user_id = (SELECT core.current_user_id())`). The links between the three
 * tables are composite `(user_id, ...)` foreign keys, as migration 030 does for
 * a debt's account: PostgreSQL checks a foreign key without row-level security,
 * so a plain key would let one person's allocation name another person's debt
 * or lump sum. To give the keys something to point at, `debts` gets a
 * `UNIQUE (user_id, id)` constraint (the pattern of migration 009); it adds no
 * restriction, since `id` is already the primary key, and it is the only change
 * to an existing table. No column is added to `debts`: the later estimated
 * balance work adds its own.
 *
 * **Deleting** a debt removes the parts aimed at it (the money then follows the
 * strategy); deleting a lump sum removes its parts. Deleting a user removes
 * everything.
 *
 * Grants need nothing new: the plugin's role already has data access to every
 * table in its schema, including tables added later (see `plugin-roles.ts`).
 *
 * Purely additive and safe to re-run: existing objects are left as they are.
 */

const SCHEMA = 'plugin_debt_payoff'
const DEBTS = `${SCHEMA}.debts`
const LUMP_SUMS = `${SCHEMA}.lump_sums`
const ALLOCATIONS = `${SCHEMA}.lump_sum_allocations`

/**
 * Creates both tables with their constraints, indexes and policies.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_debt_payoff.lump_sums (
      id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      -- The day the money is paid. A date before today is kept (the person may
      -- want to see and remove it) but the plan ignores it.
      on_date     date NOT NULL,
      amount      numeric(19,4) NOT NULL,
      note        varchar(200) NOT NULL DEFAULT '',
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT ck_lump_sums_amount CHECK (amount > 0)
    )
  `.execute(db)

  // Targets for the composite keys below.
  await addUniqueConstraintIfMissing(db, DEBTS, 'ux_debts_user_id', 'user_id, id')
  await addUniqueConstraintIfMissing(db, LUMP_SUMS, 'ux_lump_sums_user_id', 'user_id, id')

  await sql`
    CREATE TABLE IF NOT EXISTS plugin_debt_payoff.lump_sum_allocations (
      lump_sum_id  uuid NOT NULL,
      user_id      uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      debt_id      uuid NOT NULL,
      amount       numeric(19,4) NOT NULL,

      CONSTRAINT pk_lump_sum_allocations PRIMARY KEY (lump_sum_id, debt_id),
      CONSTRAINT ck_lump_sum_allocations_amount CHECK (amount > 0)
    )
  `.execute(db)

  await addConstraintIfMissing(
    db, ALLOCATIONS, 'fk_lump_sum_allocations_lump_sum',
    `FOREIGN KEY (user_id, lump_sum_id) REFERENCES ${LUMP_SUMS} (user_id, id) ON DELETE CASCADE`,
  )
  await addConstraintIfMissing(
    db, ALLOCATIONS, 'fk_lump_sum_allocations_debt',
    `FOREIGN KEY (user_id, debt_id) REFERENCES ${DEBTS} (user_id, id) ON DELETE CASCADE`,
  )

  // Listing: a person's lump sums by date. The user_id prefix is what row-level security filters on.
  await createIndexIfMissing(db, `${SCHEMA}.ix_lump_sums_user_date`, `ON ${LUMP_SUMS} (user_id, on_date, id)`)
  // Finding the parts aimed at a debt, which deleting the debt does.
  await createIndexIfMissing(db, `${SCHEMA}.ix_lump_sum_allocations_user_debt`, `ON ${ALLOCATIONS} (user_id, debt_id)`)

  // FORCE, as for the other tables in this schema: no SECURITY DEFINER function touches them.
  for (const table of ['lump_sums', 'lump_sum_allocations']) {
    await ensureRowSecurity(db, `${SCHEMA}.${table}`, true)
    await ensurePolicy(
      db,
      `${SCHEMA}.${table}`,
      `${table}_isolation`,
      'user_id = (SELECT core.current_user_id())',
    )
  }
}

/**
 * Drops both tables, which discards every person's lump sums, and the unique
 * constraint on `debts`. The debts themselves are kept.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS plugin_debt_payoff.lump_sum_allocations`.execute(db)
  await sql`DROP TABLE IF EXISTS plugin_debt_payoff.lump_sums`.execute(db)
  await dropConstraintIfExists(db, DEBTS, 'ux_debts_user_id')
}
