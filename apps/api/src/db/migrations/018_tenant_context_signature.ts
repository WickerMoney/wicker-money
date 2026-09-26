import { sql, type Kysely } from 'kysely'

/**
 * @module
 * Signed tenant context.
 *
 * Every row-level security policy resolves the tenant through
 * `core.current_user_id()`. That function used to read the `app.user_id`
 * setting directly, and any SQL running in the transaction can change a
 * setting, so a query could switch tenant. It now returns a user id only when
 * the `app.user_sig` setting carries the HMAC-SHA256 of that id under a key
 * held in a table no application or plugin role can read. Without a valid
 * signature the function returns NULL, which matches no row.
 *
 * Every policy is also rewritten to call the function through a scalar
 * subquery, `(SELECT core.current_user_id())`. A bare call in a policy filter
 * is re-evaluated for every row a sequential scan visits, and verifying a
 * signature is far dearer than reading a setting; the subquery makes it an
 * InitPlan evaluated once per statement. (For a user who owns most of a table
 * the planner picks a sequential scan, so this is the common case.)
 *
 * The migration installs the mechanism but never a key: the key is derived
 * from the deployment's secret by the application and installed with
 * `core.install_tenant_context_key`. Until a key is installed every tenant
 * table reads as empty (fail closed).
 */

/**
 * Finds the schema pgcrypto lives in, so the function can call `hmac`
 * schema-qualified under a pinned `search_path`.
 *
 * @param db - Migration connection (database owner).
 * @returns The quoted schema identifier.
 */
async function pgcryptoSchema(db: Kysely<unknown>): Promise<string> {
  const { rows } = await sql<{ schema: string }>`
    SELECT quote_ident(n.nspname) AS schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto'
  `.execute(db)
  const schema = rows[0]?.schema
  if (schema === undefined) throw new Error('pgcrypto is not installed')
  return schema
}

/** Matches a bare call to the function inside a policy expression as PostgreSQL prints it. */
const BARE_CALL = '(core\\.)?current_user_id\\(\\)'

/** Matches the scalar-subquery form as PostgreSQL prints it. */
const WRAPPED_CALL = '\\(\\s*SELECT (core\\.)?current_user_id\\(\\)( AS current_user_id)?\\)'

/** Text that identifies an already-wrapped policy expression. */
const WRAPPED_MARKER = 'SELECT (core\\.)?current_user_id'

/**
 * Rewrites the USING and WITH CHECK expression of every policy that calls
 * `core.current_user_id()`, changing how the call is written.
 *
 * Policies are found in the catalog rather than listed, because policies on
 * plugin tables are created by other migrations. Policies already in the target
 * form (matching `unless`) are left alone, so re-running changes nothing.
 *
 * @param db - Migration connection (database owner).
 * @param from - Regular expression matching the call as currently written.
 * @param to - Replacement text (`$`-free; it is inserted literally).
 * @param unless - Regular expression identifying policies already in the target form; empty for none.
 */
async function rewritePolicies(
  db: Kysely<unknown>,
  from: string,
  to: string,
  unless: string,
): Promise<void> {
  await sql`
    DO $$
    DECLARE
      r record;
      using_sql text;
      check_sql text;
    BEGIN
      FOR r IN
        SELECT p.polname, c.oid::regclass AS tbl,
               pg_get_expr(p.polqual, p.polrelid) AS q,
               pg_get_expr(p.polwithcheck, p.polrelid) AS w
        FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE pg_get_expr(p.polqual, p.polrelid) ~ 'current_user_id'
           OR pg_get_expr(p.polwithcheck, p.polrelid) ~ 'current_user_id'
      LOOP
        CONTINUE WHEN NOT (coalesce(r.q, '') ~ ${sql.lit(from)} OR coalesce(r.w, '') ~ ${sql.lit(from)});
        CONTINUE WHEN ${sql.lit(unless)} <> ''
                      AND (coalesce(r.q, '') ~ ${sql.lit(unless)} OR coalesce(r.w, '') ~ ${sql.lit(unless)});
        using_sql := regexp_replace(r.q, ${sql.lit(from)}, ${sql.lit(to)}, 'g');
        IF r.w IS NULL THEN
          EXECUTE format('ALTER POLICY %I ON %s USING (%s)', r.polname, r.tbl, using_sql);
        ELSE
          check_sql := regexp_replace(r.w, ${sql.lit(from)}, ${sql.lit(to)}, 'g');
          EXECUTE format('ALTER POLICY %I ON %s USING (%s) WITH CHECK (%s)',
                         r.polname, r.tbl, using_sql, check_sql);
        END IF;
      END LOOP;
    END
    $$
  `.execute(db)
}

/**
 * Creates the key table, the install function and the signature-checking
 * `core.current_user_id()`.
 *
 * Safe to re-run and safe on a database that already holds data and a key:
 * an installed key is never touched.
 *
 * @param db - Migration connection (database owner).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db)
  const crypto = sql.raw(await pgcryptoSchema(db))

  // Single row, enforced by the constant primary key.
  await sql`
    CREATE TABLE IF NOT EXISTS core.tenant_context_key (
      id  boolean PRIMARY KEY DEFAULT true CHECK (id),
      key bytea NOT NULL CHECK (octet_length(key) >= 32)
    )
  `.execute(db)
  // Not row-level secured on purpose: only the owner (and the SECURITY DEFINER
  // function it owns) may touch it, and the default privileges that hand DML on
  // new core tables to the application role must not apply here.
  await sql`REVOKE ALL ON core.tenant_context_key FROM PUBLIC`.execute(db)
  await sql`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT DISTINCT a.grantee
        FROM pg_class c, aclexplode(c.relacl) a
        WHERE c.oid = 'core.tenant_context_key'::regclass AND a.grantee <> c.relowner
      LOOP
        EXECUTE format('REVOKE ALL ON core.tenant_context_key FROM %s',
                       CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END);
      END LOOP;
    END
    $$
  `.execute(db)

  await sql`
    CREATE OR REPLACE FUNCTION core.install_tenant_context_key(new_key bytea) RETURNS void
    LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
      INSERT INTO core.tenant_context_key (id, key) VALUES (true, new_key)
      ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key
    $$
  `.execute(db)
  await sql`REVOKE ALL ON FUNCTION core.install_tenant_context_key(bytea) FROM PUBLIC`.execute(db)

  // Runs as the owner so it can read the key; the caller never can. Malformed
  // input must yield NULL, never an error, so both settings are pattern-checked
  // before the uuid cast. The signatures are compared through SHA-256 so the
  // comparison time does not depend on how many leading characters matched.
  await sql`
    CREATE OR REPLACE FUNCTION core.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
    SET search_path = pg_catalog, pg_temp AS $$
      SELECT CASE
        WHEN k.key IS NOT NULL
         AND s.uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND s.sig ~ '^[0-9a-f]{64}$'
         AND sha256(decode(s.sig, 'hex'))
             = sha256(${crypto}.hmac(convert_to(s.uid, 'UTF8'), k.key, 'sha256'))
        THEN s.uid::uuid
      END
      FROM (
        SELECT nullif(current_setting('app.user_id', true), '') AS uid,
               nullif(current_setting('app.user_sig', true), '') AS sig
      ) s
      LEFT JOIN core.tenant_context_key k ON true
    $$
  `.execute(db)

  await rewritePolicies(db, BARE_CALL, '(SELECT core.current_user_id())', WRAPPED_MARKER)
}

/**
 * Restores the bare policy calls and the unsigned `core.current_user_id()`, and removes the key table and
 * install function. The pgcrypto extension is left in place.
 *
 * @param db - Migration connection (database owner).
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await rewritePolicies(db, WRAPPED_CALL, 'core.current_user_id()', '')
  await sql`
    CREATE OR REPLACE FUNCTION core.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY INVOKER PARALLEL UNSAFE AS $$
      SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
    $$
  `.execute(db)
  await sql`DROP FUNCTION IF EXISTS core.install_tenant_context_key(bytea)`.execute(db)
  await sql`DROP TABLE IF EXISTS core.tenant_context_key`.execute(db)
}
