import { sql, type Kysely } from 'kysely'
import { createIndexIfMissing } from './support/index.js'

/**
 * Creates the ledger tables: accounts, categories, category rules,
 * transactions, transaction splits, recurring items and the plugin registry.
 *
 * Every user-owned table carries `user_id` directly (rather than reaching the
 * owner through a join) so a row-level security policy can filter each table
 * on its own column. Money columns are `numeric(19,4)`; account balances are
 * never stored.
 *
 * Safe to re-run: existing tables and indexes are left as they are, so later
 * changes to them (constraints, dropped columns) are not undone.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS core.accounts (
      id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id         uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      name            varchar(200) NOT NULL,
      account_type    core.account_type NOT NULL,
      -- Opening balance. The current balance is DERIVED as
      -- initial_balance + SUM(transactions.amount) and never stored, which
      -- removes the stale-denormalisation class of bug entirely.
      initial_balance numeric(19,4) NOT NULL DEFAULT 0,
      currency_code   char(3)       NOT NULL DEFAULT 'USD',
      buffer_amount   numeric(19,4) NOT NULL DEFAULT 0,
      archived_at     timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_accounts_buffer_non_negative CHECK (buffer_amount >= 0)
    )
  `.execute(db)
  await createIndexIfMissing(db, 'core.ix_accounts_user_id', 'ON core.accounts (user_id)')

  await sql`
    CREATE TABLE IF NOT EXISTS core.categories (
      id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      name        varchar(100) NOT NULL,
      slug        varchar(100) NOT NULL,
      parent_id   uuid REFERENCES core.categories(id) ON DELETE RESTRICT,
      icon        varchar(50),
      is_system   boolean NOT NULL DEFAULT false,
      is_enabled  boolean NOT NULL DEFAULT true,
      sort_order  integer NOT NULL DEFAULT 0,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
    )
  `.execute(db)
  // slug is unique per user, not globally: two households may both have "groceries"
  await createIndexIfMissing(db, 'core.ux_categories_user_slug', 'ON core.categories (user_id, slug)', { unique: true })
  await createIndexIfMissing(db, 'core.ix_categories_parent_id', 'ON core.categories (parent_id)')

  await sql`
    CREATE TABLE IF NOT EXISTS core.category_rules (
      id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id           uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      category_id       uuid NOT NULL REFERENCES core.categories(id) ON DELETE CASCADE,
      rule_type         core.rule_match_type NOT NULL,
      match_value       varchar(500) NOT NULL,
      priority          integer NOT NULL DEFAULT 0,
      is_case_sensitive boolean NOT NULL DEFAULT false,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_category_rules_match_value_not_blank CHECK (btrim(match_value) <> '')
    )
  `.execute(db)
  // Rule resolution order is priority DESC, created_at ASC. Indexed to match,
  // so ties break deterministically instead of on whatever the heap returns.
  await createIndexIfMissing(
    db,
    'core.ix_category_rules_resolution',
    'ON core.category_rules (user_id, priority DESC, created_at ASC)',
  )

  await sql`
    CREATE TABLE IF NOT EXISTS core.transactions (
      id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id             uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      account_id          uuid NOT NULL REFERENCES core.accounts(id) ON DELETE RESTRICT,
      amount              numeric(19,4) NOT NULL,
      merchant            varchar(300) NOT NULL,
      category_id         uuid REFERENCES core.categories(id) ON DELETE RESTRICT,
      -- Protects hand-made categorizations from bulk rule reapplication.
      category_source     core.category_source,
      transaction_date    date NOT NULL,
      notes               varchar(1000),
      -- Authoritative dedupe key when the source provides one; unique per
      -- account (partial unique index below).
      external_id         varchar(255),
      -- Transfers are first-class (a counterpart account) rather than a boolean
      -- plus a convention, so a transfer cannot be mistaken for income.
      transfer_account_id uuid REFERENCES core.accounts(id) ON DELETE RESTRICT,
      is_split            boolean NOT NULL DEFAULT false,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_transactions_transfer_not_self
        CHECK (transfer_account_id IS NULL OR transfer_account_id <> account_id),
      CONSTRAINT ck_transactions_categorized_has_source
        CHECK ((category_id IS NULL) = (category_source IS NULL))
    )
  `.execute(db)
  await createIndexIfMissing(
    db,
    'core.ix_transactions_user_date',
    'ON core.transactions (user_id, transaction_date DESC)',
  )
  await createIndexIfMissing(db, 'core.ix_transactions_category_id', 'ON core.transactions (category_id)')
  await createIndexIfMissing(
    db,
    'core.ux_transactions_account_external_id',
    'ON core.transactions (account_id, external_id) WHERE external_id IS NOT NULL',
    { unique: true },
  )

  await sql`
    CREATE TABLE IF NOT EXISTS core.transaction_splits (
      id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id        uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      transaction_id uuid NOT NULL REFERENCES core.transactions(id) ON DELETE CASCADE,
      amount         numeric(19,4) NOT NULL,
      category_id    uuid REFERENCES core.categories(id) ON DELETE RESTRICT,
      notes          varchar(1000),
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await createIndexIfMissing(
    db,
    'core.ix_transaction_splits_transaction_id',
    'ON core.transaction_splits (transaction_id)',
  )

  await sql`
    CREATE TABLE IF NOT EXISTS core.recurring_items (
      id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id             uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      account_id          uuid NOT NULL REFERENCES core.accounts(id) ON DELETE RESTRICT,
      name                varchar(255) NOT NULL,
      amount              numeric(19,4) NOT NULL,
      frequency           core.recurrence_frequency NOT NULL,
      -- Immutable anchor the recurrence maths is computed from. Nothing
      -- advances it; "next due" is derived, so it can never be read as a
      -- moving pointer.
      series_start_date   date NOT NULL,
      end_date            date,
      category_id         uuid REFERENCES core.categories(id) ON DELETE RESTRICT,
      is_income           boolean NOT NULL DEFAULT false,
      transfer_account_id uuid REFERENCES core.accounts(id) ON DELETE RESTRICT,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_recurring_items_end_after_start
        CHECK (end_date IS NULL OR end_date >= series_start_date),
      -- Income and transfer are mutually exclusive states.
      CONSTRAINT ck_recurring_items_income_xor_transfer
        CHECK (NOT (is_income AND transfer_account_id IS NOT NULL))
    )
  `.execute(db)
  await createIndexIfMissing(db, 'core.ix_recurring_items_user_id', 'ON core.recurring_items (user_id)')

  await sql`
    CREATE TABLE IF NOT EXISTS core.plugins (
      id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      plugin_id    varchar(200) NOT NULL,
      version      varchar(50)  NOT NULL,
      enabled      boolean NOT NULL DEFAULT true,
      -- bundled plugins ship in the image and are enabled on first boot, but
      -- hold no privilege a third-party plugin could not also request.
      bundled      boolean NOT NULL DEFAULT false,
      settings     jsonb   NOT NULL DEFAULT '{}'::jsonb,
      installed_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)
  await createIndexIfMissing(db, 'core.ux_plugins_plugin_id', 'ON core.plugins (plugin_id)', { unique: true })
}

/**
 * Drops the ledger tables created by {@link up}.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    'plugins', 'recurring_items', 'transaction_splits',
    'transactions', 'category_rules', 'categories', 'accounts',
  ]) {
    await sql`DROP TABLE IF EXISTS ${sql.raw(`core.${t}`)} CASCADE`.execute(db)
  }
}
