import { sql, type Kysely } from 'kysely'

/**
 * @module
 * Per-statement tenant lookup in every policy.
 *
 * Migration 018 rewrote each policy that called `core.current_user_id()` to
 * call it through a scalar subquery, `(SELECT core.current_user_id())`, so the
 * signature check runs once per statement (an InitPlan) instead of once for
 * every row a scan visits. It rewrote the policies that existed when it ran.
 * Migration 027 created `plugin_budgets.account_lines_isolation` afterwards,
 * with the bare call, and nothing rewrote it: on a database that had not
 * re-run 018 since, that policy was still evaluated per row.
 *
 * This migration rewrites any policy in `core` or a `plugin_*` schema that
 * still has a bare call, in either clause. The two forms return the same rows,
 * so no access changes, only how often the lookup runs. It is a no-op on a
 * database where none is left, and it takes a table lock only for a policy it
 * actually changes.
 *
 * The convention for a new policy is the subquery form, which `ensurePolicy`
 * callers must write out; `rls-invariants.integration.test.ts` fails if a
 * policy comes out of the migrations in any other form.
 */

/** A call to the function as PostgreSQL prints it, with or without the schema. */
const CALL = '(core\\.)?current_user_id\\(\\)'

/** The scalar-subquery form as PostgreSQL prints it: `( SELECT core.current_user_id() AS current_user_id)`. */
const WRAPPED = '\\(\\s*SELECT\\s+(core\\.)?current_user_id\\(\\)(\\s+AS\\s+current_user_id)?\\s*\\)'

/** Stands in for a wrapped call while the bare ones are rewritten; it cannot occur in a printed expression. */
const MARK = '@@wrapped-tenant-lookup@@'

/** The form every policy is written in. */
const TARGET = '(SELECT core.current_user_id())'

/**
 * Rewrites every bare `core.current_user_id()` in the USING and WITH CHECK
 * expressions of the policies in `core` and `plugin_*` schemas to the
 * subquery form.
 *
 * A policy is changed only when an expression still holds a bare call after
 * the already-wrapped calls are set aside, so re-running changes nothing and
 * locks nothing. A policy that has only a USING or only a WITH CHECK clause
 * keeps that shape. Command, roles and permissiveness are left as they are,
 * since `ALTER POLICY` does not touch them.
 *
 * Safe to re-run.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    DECLARE
      r record;
      new_q text;
      new_w text;
      parts text[];
    BEGIN
      FOR r IN
        SELECT p.polname, format('%I.%I', n.nspname, c.relname) AS tbl,
               pg_get_expr(p.polqual, p.polrelid) AS q,
               pg_get_expr(p.polwithcheck, p.polrelid) AS w
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE (n.nspname = 'core' OR n.nspname LIKE 'plugin\\_%')
          AND (pg_get_expr(p.polqual, p.polrelid) ~ 'current_user_id'
               OR pg_get_expr(p.polwithcheck, p.polrelid) ~ 'current_user_id')
        ORDER BY n.nspname, c.relname, p.polname
      LOOP
        -- Nothing bare once the wrapped calls are set aside: leave the policy,
        -- and the table lock an ALTER would take, alone.
        CONTINUE WHEN NOT (
          regexp_replace(coalesce(r.q, ''), ${sql.lit(WRAPPED)}, '', 'g') ~ ${sql.lit(CALL)}
          OR regexp_replace(coalesce(r.w, ''), ${sql.lit(WRAPPED)}, '', 'g') ~ ${sql.lit(CALL)}
        );

        -- Mark the wrapped calls, rewrite what is left, then restore the marks
        -- as the canonical wrapped form.
        new_q := replace(
          regexp_replace(regexp_replace(r.q, ${sql.lit(WRAPPED)}, ${sql.lit(MARK)}, 'g'),
                         ${sql.lit(CALL)}, ${sql.lit(TARGET)}, 'g'),
          ${sql.lit(MARK)}, ${sql.lit(TARGET)});
        new_w := replace(
          regexp_replace(regexp_replace(r.w, ${sql.lit(WRAPPED)}, ${sql.lit(MARK)}, 'g'),
                         ${sql.lit(CALL)}, ${sql.lit(TARGET)}, 'g'),
          ${sql.lit(MARK)}, ${sql.lit(TARGET)});

        parts := ARRAY[]::text[];
        IF new_q IS NOT NULL THEN parts := parts || format('USING (%s)', new_q); END IF;
        IF new_w IS NOT NULL THEN parts := parts || format('WITH CHECK (%s)', new_w); END IF;
        EXECUTE format('ALTER POLICY %I ON %s %s', r.polname, r.tbl, array_to_string(parts, ' '));
      END LOOP;
    END
    $$
  `.execute(db)
}

/**
 * Does nothing.
 *
 * The subquery form and the bare call return the same rows, so there is no
 * behaviour to take back, and restoring the bare call would only bring back the
 * per-row evaluation this migration removes. (Migration 018's `down` still
 * turns every policy back into the bare form when it is reverted, which is
 * where the unsigned function comes back too.)
 *
 * @param _db - Migration connection (database owner).
 */
export async function down(_db: Kysely<unknown>): Promise<void> {
  // Intentionally empty: see above.
}
