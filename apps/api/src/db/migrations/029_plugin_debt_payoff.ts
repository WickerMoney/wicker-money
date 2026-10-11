import { sql, type Kysely } from 'kysely'
import {
  addConstraintIfMissing,
  createIndexIfMissing,
  ensurePolicy,
  ensureRowSecurity,
} from './support/index.js'

/**
 * @module
 * The debt payoff plugin's own tables, in the `plugin_debt_payoff` schema.
 *
 * - `debts`: what a person owes and to whom, one row per debt. A balance, an
 *   APR and a minimum payment are what the snowball and avalanche engine needs;
 *   nothing derived is stored. The payoff schedule, total interest and the
 *   debt-free date are computed on every read from these rows and the plan
 *   settings, so they can never disagree with the debts on the page.
 * - `plan_settings`: one row per user holding the extra monthly payment and
 *   the strategy. A row exists only once the person has saved a choice; until
 *   then the plugin answers with the defaults.
 *
 * **Money** is `numeric(19,4)` like every other amount; the APR is a
 * percentage in `numeric(7,4)` (24.9900 is 24.99%, up to 999.9999%). Neither
 * is ever a `number` in TypeScript.
 *
 * **Ownership.** Both tables carry `user_id`, have row-level security
 * *forced*, and use the policy shape every table since migration 018 uses
 * (`user_id = (SELECT core.current_user_id())`, which is evaluated once per
 * statement, not once per row). A debt's link to an account is a composite
 * `(user_id, account_id)` foreign key against `core.accounts (user_id, id)`,
 * the pattern from migrations 009, 011 and 027: PostgreSQL checks a foreign
 * key with the referenced table's privileges and ignores its row-level
 * security, so a plain `REFERENCES core.accounts (id)` would let one user's
 * debt name another user's account. With the composite key that is
 * impossible for every writer, this plugin included.
 *
 * **Deleting an account** does not delete the debt. A debt is a fact about
 * what is owed, not about which account paid it, so the link is cleared
 * (`ON DELETE SET NULL (account_id)`, the column-list form PostgreSQL has had
 * since 15, as in migration 024) and `user_id` is left alone. The account
 * screens still count the debt as a reference, so deleting a linked account
 * asks first rather than silently unlinking.
 *
 * **One debt per account.** Two active debts linked to the same loan would
 * count its balance twice, so a partial unique index allows one link per
 * account among debts that are not archived. An archived (paid off or hidden)
 * debt keeps its link without blocking a new one.
 *
 * The account's *type* (a loan or credit card) is not enforced here. An
 * account's type is mutable and lives in another table, so a constraint here
 * could not stay true; the plugin's service checks it on write.
 *
 * Safe to re-run: existing objects are left as they are.
 */

const SCHEMA = 'plugin_debt_payoff'

/**
 * Creates the schema, both tables, their constraints, indexes and policies.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS plugin_debt_payoff`.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS plugin_debt_payoff.debts (
      id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id          uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      name             varchar(100) NOT NULL,
      -- What is owed now, as a positive number. Zero is a debt that is paid off
      -- but still wanted on the page.
      balance          numeric(19,4) NOT NULL,
      -- Annual percentage rate, as a percentage: 24.9900 is 24.99%. Zero is
      -- allowed (a family loan, a 0% promotion).
      apr              numeric(7,4) NOT NULL,
      minimum_payment  numeric(19,4) NOT NULL,
      -- The loan or credit card account this debt tracks, if any. Optional: a
      -- debt to a person, or to a lender the ledger does not hold an account for.
      account_id       uuid,
      -- Where the person put it in their own list; also the tie-break when two
      -- debts are otherwise equal to a strategy.
      sort_order       integer NOT NULL DEFAULT 0,
      archived         boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT ck_debts_name CHECK (length(btrim(name)) > 0),
      CONSTRAINT ck_debts_balance CHECK (balance >= 0),
      CONSTRAINT ck_debts_apr CHECK (apr >= 0),
      CONSTRAINT ck_debts_minimum_payment CHECK (minimum_payment >= 0)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS plugin_debt_payoff.plan_settings (
      user_id        uuid PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
      -- Paid every month on top of the minimums.
      extra_payment  numeric(19,4) NOT NULL DEFAULT 0,
      -- A CHECK rather than an enum: adding a strategy later is a constraint
      -- swap, not an ALTER TYPE.
      strategy       varchar(16) NOT NULL DEFAULT 'avalanche',
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT ck_plan_settings_extra_payment CHECK (extra_payment >= 0),
      CONSTRAINT ck_plan_settings_strategy CHECK (strategy IN ('snowball', 'avalanche'))
    )
  `.execute(db)

  // Listing: a person's debts in their own order. The user_id prefix is what
  // row-level security filters on, so every query starts here.
  await createIndexIfMissing(
    db,
    'plugin_debt_payoff.ix_debts_user_order',
    'ON plugin_debt_payoff.debts (user_id, archived, sort_order, created_at)',
  )
  // One active debt per account.
  await createIndexIfMissing(
    db,
    'plugin_debt_payoff.ux_debts_user_account_active',
    'ON plugin_debt_payoff.debts (user_id, account_id) WHERE account_id IS NOT NULL AND NOT archived',
    { unique: true },
  )

  await addConstraintIfMissing(
    db,
    'plugin_debt_payoff.debts',
    'fk_debts_account_owned',
    'FOREIGN KEY (user_id, account_id) REFERENCES core.accounts (user_id, id) ON DELETE SET NULL (account_id)',
  )

  // FORCE: no SECURITY DEFINER function touches these tables, so nothing needs
  // the owner exemption that core.users and core.sessions need.
  for (const table of ['debts', 'plan_settings']) {
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
 * Drops the schema and everything in it: every person's debts and plan
 * settings.
 *
 * The plugin's database role is left in place. Roles are cluster-wide and are
 * created and revoked by `pnpm migrate` from the plugin manifests, not by a
 * migration.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS plugin_debt_payoff CASCADE`.execute(db)
}
