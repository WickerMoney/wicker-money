import { sql, type Kysely } from 'kysely'
import {
  addConstraintIfMissing,
  addUniqueConstraintIfMissing,
  columnExists,
  createEnumIfMissing,
  createIndexIfMissing,
  dropConstraintIfExists,
  ensurePolicy,
  ensureRowSecurity,
  withOwnerBackfillAccess,
} from './support/index.js'

/** The flat rule columns this migration retires, in the order they are dropped. */
const RETIRED_COLUMNS = ['rule_type', 'match_value', 'is_case_sensitive'] as const

/**
 * Gives categorization rules multiple conditions, AND-ed together, so more than
 * one signal can decide a category. Creates `core.category_rule_conditions`,
 * moves each existing rule's single match into a condition row, and drops the
 * old flat columns from `core.category_rules`.
 *
 * A merchant rule alone cannot separate "every cheque for 375.00 is the car
 * payment" from every other cheque, because the merchant text on a cheque is
 * the same ("CHECK") regardless of what it paid for. The only way to tell them
 * apart is the amount, and a single `rule_type` / `match_value` pair has
 * nowhere to put one.
 *
 * Conditions live in a child table rather than a jsonb column on
 * `category_rules`. A jsonb column would make a new condition type a parser
 * change nothing validates; a new enum value plus a few nullable columns is
 * additive and the database can still enforce it with a CHECK. Money stays
 * `numeric`, never jsonb, for the same reason it is never a float.
 *
 * A rule matches when EVERY one of its conditions matches (AND-only). OR
 * already exists across rules, since every rule is evaluated independently and
 * the first match wins, so there is no OR/grouping within a single rule.
 *
 * Amount conditions store a positive magnitude plus a direction ('in' | 'out')
 * rather than a signed value. `core.transactions.amount` is signed, but a
 * magnitude plus an explicit direction is the same information and harder to
 * enter with the sign backwards (which would silently match nothing). Matching
 * code converts to the signed amount.
 *
 * Rule resolution order becomes `priority DESC, condition_count DESC,
 * created_at ASC`. Priority still wins whenever it is set; the condition count
 * only breaks a *tie*, in favour of the more specific rule instead of
 * whichever was created first. Rules with one condition all tie on count, so
 * their relative order (by `created_at`) is unchanged by the migration.
 *
 * Safe to re-run: every step is skipped once done. Rules are converted only
 * while the old flat columns still exist, and only those without a condition
 * yet, so a run interrupted after the conversion resumes without duplicating
 * anything.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await createEnumIfMissing(db, 'core.rule_condition_type', [
    'merchant_exact', 'merchant_contains', 'description_contains',
    'amount_exact', 'amount_range',
  ])

  await createEnumIfMissing(db, 'core.amount_direction', ['in', 'out'])

  // A foreign key is evaluated with the referenced table's privileges and
  // bypasses RLS, so a plain `rule_id -> id` reference would let a condition
  // silently point at another user's rule. The composite (user_id, id) key
  // below needs a unique constraint covering exactly the columns it targets.
  await addUniqueConstraintIfMissing(
    db,
    'core.category_rules',
    'uq_category_rules_user_id_id',
    'user_id, id',
  )

  // No CHECK yet — it is added after the backfill below. A constraint
  // describing the state a backfill produces would fail on the pre-backfill
  // data if it were declared first.
  await sql`
    CREATE TABLE IF NOT EXISTS core.category_rule_conditions (
      id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id           uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      rule_id           uuid NOT NULL,
      condition_type    core.rule_condition_type NOT NULL,
      -- merchant_exact / merchant_contains / description_contains
      text_value        varchar(500),
      is_case_sensitive boolean NOT NULL DEFAULT false,
      -- amount_exact / amount_range. Magnitude + direction, never signed
      -- (the signed transaction amount is compared by direction).
      direction         core.amount_direction,
      amount_value      numeric(19,4),
      amount_min        numeric(19,4),
      amount_max        numeric(19,4),
      created_at        timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db)

  await addConstraintIfMissing(
    db,
    'core.category_rule_conditions',
    'fk_category_rule_conditions_rule_id_owned',
    'FOREIGN KEY (user_id, rule_id) REFERENCES core.category_rules (user_id, id) ON DELETE CASCADE',
  )

  await createIndexIfMissing(
    db,
    'core.ix_category_rule_conditions_rule_id',
    'ON core.category_rule_conditions (rule_id)',
  )

  // Same isolation as every other core table: ENABLE + FORCE, policy keyed on
  // core.current_user_id().
  await ensureRowSecurity(db, 'core.category_rule_conditions', true)
  await ensurePolicy(
    db,
    'core.category_rule_conditions',
    'category_rule_conditions_isolation',
    'user_id = core.current_user_id()',
  )

  if (await columnExists(db, 'core.category_rules', 'rule_type')) {
    await backfillRuleConditions(db)
  }

  // Discriminated shape, one branch per condition_type. Added after the
  // backfill so it validates the backfill's own output rather than rejecting
  // the migration before that output exists.
  await addConstraintIfMissing(
    db,
    'core.category_rule_conditions',
    'ck_category_rule_conditions_shape',
    `CHECK (
        (
          condition_type IN ('merchant_exact', 'merchant_contains', 'description_contains')
          AND text_value IS NOT NULL AND btrim(text_value) <> ''
          AND direction IS NULL
          AND amount_value IS NULL AND amount_min IS NULL AND amount_max IS NULL
        )
        OR (
          condition_type = 'amount_exact'
          AND amount_value IS NOT NULL AND amount_value > 0
          AND direction IS NOT NULL
          AND text_value IS NULL
          AND amount_min IS NULL AND amount_max IS NULL
        )
        OR (
          condition_type = 'amount_range'
          AND direction IS NOT NULL
          AND (amount_min IS NOT NULL OR amount_max IS NOT NULL)
          AND (amount_min IS NULL OR amount_min > 0)
          AND (amount_max IS NULL OR amount_max > 0)
          AND (amount_min IS NULL OR amount_max IS NULL OR amount_min <= amount_max)
          AND text_value IS NULL AND amount_value IS NULL
        )
      )`,
  )

  // "A rule has at least one condition" is deliberately not enforced here: a
  // cross-table "at least one child row exists" invariant needs a deferred
  // constraint trigger to be checkable at commit rather than per statement,
  // which is real weight. The application validates it on every write instead,
  // and a rule with no conditions matches nothing.

  // The old flat shape is retired now that every existing rule has an
  // equivalent condition row. Each statement takes an exclusive table lock even
  // when there is nothing to drop, so only what is still present is touched.
  await dropConstraintIfExists(db, 'core.category_rules', 'ck_category_rules_match_value_not_blank')
  const present: string[] = []
  for (const column of RETIRED_COLUMNS) {
    if (await columnExists(db, 'core.category_rules', column)) present.push(column)
  }
  if (present.length > 0) {
    await sql`
      ALTER TABLE core.category_rules
        ${sql.join(present.map((c) => sql`DROP COLUMN ${sql.raw(c)}`))}
    `.execute(db)
  }

  // core.rule_match_type is left in place, unused, rather than dropped here.
  // It is still needed by down() to restore the old column, and an unused enum
  // costs nothing.
}

/**
 * Tells the migrator to run this migration without wrapping it in a
 * transaction, so the constraint scans hold their locks only for their own
 * statements. Every step is idempotent.
 */
export const transactional = false

/**
 * Gives every existing rule the one condition row equivalent to its old
 * `rule_type` / `match_value` / `is_case_sensitive`.
 *
 * `core.category_rules` runs FORCE row-level security, and
 * `category_rule_conditions` is created with FORCE already on by the time this
 * runs — so the owner running the migration (with no tenant context) can see
 * neither the rows it is reading nor, since the WITH CHECK policy would fail,
 * the rows it is about to write. Both tables get a temporary owner-only policy
 * for the duration of one transaction. `SET LOCAL row_security = off` is
 * refused for a role that cannot bypass RLS, and FORCE is precisely what
 * removes that ability.
 *
 * A single set-based INSERT, restricted to rules that have no condition yet so
 * that running it twice adds nothing.
 *
 * Exported so a test can run it against real data.
 *
 * @param db - Migration connection (database owner) or an open transaction.
 */
export async function backfillRuleConditions(db: Kysely<unknown>): Promise<void> {
  await withOwnerBackfillAccess(
    db,
    ['core.category_rules', 'core.category_rule_conditions'],
    async (trx) => {
      // rule_type and condition_type are two different enum types that
      // happen to share their first three value spellings. PostgreSQL enums are
      // nominal, not structural, so the shared spelling does not make this an
      // implicit conversion: it has to go through text.
      await sql`
        INSERT INTO core.category_rule_conditions
          (user_id, rule_id, condition_type, text_value, is_case_sensitive)
        SELECT r.user_id, r.id, r.rule_type::text::core.rule_condition_type, r.match_value, r.is_case_sensitive
        FROM core.category_rules r
        WHERE NOT EXISTS (
          SELECT 1 FROM core.category_rule_conditions c WHERE c.rule_id = r.id
        )
      `.execute(trx)
    },
  )
}

/**
 * Restores the flat `rule_type` / `match_value` / `is_case_sensitive` columns
 * and drops the conditions table and its types.
 *
 * Best-effort: only text conditions round-trip; rules that had only amount
 * conditions come back without a `rule_type`.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE core.category_rules
      ADD COLUMN IF NOT EXISTS rule_type core.rule_match_type,
      ADD COLUMN IF NOT EXISTS match_value varchar(500),
      ADD COLUMN IF NOT EXISTS is_case_sensitive boolean NOT NULL DEFAULT false
  `.execute(db)

  await withOwnerBackfillAccess(
    db,
    ['core.category_rules', 'core.category_rule_conditions'],
    async (trx) => {
      // Best-effort restore: only text conditions round-trip, since the old
      // flat shape has no amount concept. A rule left with only amount
      // conditions gets no rule_type back and will not match anything until
      // edited.
      await sql`
        UPDATE core.category_rules r
          SET rule_type = c.condition_type::text::core.rule_match_type,
              match_value = c.text_value,
              is_case_sensitive = c.is_case_sensitive
        FROM core.category_rule_conditions c
        WHERE c.rule_id = r.id
          AND c.condition_type IN ('merchant_exact', 'merchant_contains', 'description_contains')
      `.execute(trx)
    },
  )

  await sql`
    ALTER TABLE core.category_rules
      ADD CONSTRAINT ck_category_rules_match_value_not_blank CHECK (btrim(match_value) <> '')
  `.execute(db)

  await sql`DROP TABLE IF EXISTS core.category_rule_conditions`.execute(db)
  await sql`
    ALTER TABLE core.category_rules DROP CONSTRAINT IF EXISTS uq_category_rules_user_id_id
  `.execute(db)
  await sql`DROP TYPE IF EXISTS core.amount_direction`.execute(db)
  await sql`DROP TYPE IF EXISTS core.rule_condition_type`.execute(db)
}
