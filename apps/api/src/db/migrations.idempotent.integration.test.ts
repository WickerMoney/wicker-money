import { sql, type Kysely } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from './client.js'
import { MIGRATIONS } from './migrations/index.js'
import { withOwnerBackfillAccess } from './migrations/support/index.js'
import { reapplyAll } from './migrate.js'
import { createHarness, createUser, type Harness } from '../testing/harness.js'

/**
 * Proves every migration can be run a second time on a migrated database:
 * it succeeds, changes nothing, and does not lock the tenant tables.
 *
 * The migrations run on the owner connection, the same one the migrator uses.
 * The list comes from MIGRATIONS, so a migration added later is covered
 * without editing this file.
 */
let h: Harness
let owner: Db

/** Names of the migrations in the order they run. */
const NAMES = Object.keys(MIGRATIONS).sort()

/** Schema filter shared by the catalog queries: the core schema and every plugin schema. */
const SCOPE = sql`(n.nspname = 'core' OR n.nspname LIKE 'plugin\\_%')`

/** Lock modes that stop other sessions writing (or reading) a table. */
const BLOCKING_MODES = ['ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock']

/** Everything about the schema a migration could change, as comparable plain data. */
async function snapshot(db: Kysely<unknown>): Promise<Record<string, unknown[]>> {
  const q = async (query: ReturnType<typeof sql>): Promise<unknown[]> =>
    (await query.execute(db)).rows

  return {
    columns: await q(sql`
      SELECT c.oid::regclass::text AS rel, a.attname, format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS dflt, a.attgenerated, a.attidentity
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE ${SCOPE} AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY 1, 2`),
    constraints: await q(sql`
      SELECT c.conrelid::regclass::text AS rel, c.conname, pg_get_constraintdef(c.oid) AS def, c.convalidated
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE ${SCOPE} ORDER BY 1, 2`),
    indexes: await q(sql`
      SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes n2
      WHERE schemaname = 'core' OR schemaname LIKE 'plugin\\_%' ORDER BY 1, 3`.$castTo()),
    policies: await q(sql`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname = 'core' OR schemaname LIKE 'plugin\\_%' ORDER BY 1, 2, 3`),
    rowSecurity: await q(sql`
      SELECT c.oid::regclass::text AS rel, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${SCOPE} AND c.relkind IN ('r', 'p') ORDER BY 1`),
    functions: await q(sql`
      SELECT p.oid::regprocedure::text AS fn, pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${SCOPE} ORDER BY 1`),
    enums: await q(sql`
      SELECT t.oid::regtype::text AS type, e.enumlabel
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE ${SCOPE} ORDER BY 1, e.enumsortorder`),
    // Grants: every table, sequence and schema in scope, plus default privileges.
    relationGrants: await q(sql`
      SELECT c.oid::regclass::text AS rel, pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${SCOPE} AND c.relkind IN ('r', 'p', 'S', 'v') ORDER BY 1`),
    schemaGrants: await q(sql`
      SELECT n.nspname, n.nspacl::text AS acl FROM pg_namespace n WHERE ${SCOPE} OR n.nspname = 'public' ORDER BY 1`),
    defaultGrants: await q(sql`
      SELECT d.defaclnamespace::regnamespace::text AS schema, d.defaclobjtype, d.defaclacl::text AS acl
      FROM pg_default_acl d ORDER BY 1, 2`),
    // Bookkeeping must be untouched by a re-apply.
    bookkeeping: await q(sql`SELECT name, timestamp FROM kysely_migration ORDER BY name`),
  }
}

/** Exact row count of every table in scope, read under a transient owner policy that FORCE would otherwise hide from the owner. */
async function rowCounts(db: Db): Promise<Record<string, number>> {
  const tables = (
    await sql<{ rel: string }>`
      SELECT c.oid::regclass::text AS rel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${SCOPE} AND c.relkind = 'r' AND c.relrowsecurity ORDER BY 1`.execute(db)
  ).rows.map((r) => r.rel)
  return db.transaction().execute((trx) =>
    withOwnerBackfillAccess(trx, tables, async (t) => {
      const counts: Record<string, number> = {}
      for (const table of tables) {
        const r = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.raw(table)}`.execute(t)
        counts[table] = Number(r.rows[0]?.n)
      }
      return counts
    }),
  )
}

/** Runs every migration's `up`, in order, on the given transaction. */
async function upAll(trx: Kysely<unknown>): Promise<void> {
  for (const name of NAMES) await MIGRATIONS[name]!.up(trx)
}

/** Seeds one user with an account, a category, a transfer pair and a rule, so the counts are not all zero. */
async function seed(): Promise<string> {
  const user = await createUser(h)
  await asUser(h.db, user.id, async (trx) => {
    const a = await sql<{ id: string }>`
      INSERT INTO core.accounts (user_id, name, account_type) VALUES (${user.id}, 'A', 'checking') RETURNING id`.execute(trx)
    const b = await sql<{ id: string }>`
      INSERT INTO core.accounts (user_id, name, account_type) VALUES (${user.id}, 'B', 'savings') RETURNING id`.execute(trx)
    const c = await sql<{ id: string }>`
      INSERT INTO core.categories (user_id, name, slug, kind) VALUES (${user.id}, 'Income', 'income', 'income') RETURNING id`.execute(trx)
    await sql`
      INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date, category_id, category_source)
      VALUES (${user.id}, ${a.rows[0]!.id}, 10, 'Employer', CURRENT_DATE, ${c.rows[0]!.id}, 'manual')`.execute(trx)
    const tid = crypto.randomUUID()
    await sql`
      INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date, transfer_account_id, transfer_id)
      VALUES (${user.id}, ${a.rows[0]!.id}, -5, 'Move', CURRENT_DATE, ${b.rows[0]!.id}, ${tid}),
             (${user.id}, ${b.rows[0]!.id}, 5, 'Move', CURRENT_DATE, ${a.rows[0]!.id}, ${tid})`.execute(trx)
  })
  return user.id
}

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(
    process.env['TEST_ADMIN_DATABASE_URL'] ?? 'postgresql://postgres@localhost:5432/wickermoney_test',
  )
  await seed()
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('re-running every migration', () => {
  it('covers all registered migrations', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(18)
  })

  it('succeeds and leaves the schema, grants and row counts exactly as they were', async () => {
    const schemaBefore = await snapshot(owner)
    const countsBefore = await rowCounts(owner)
    expect(Object.values(countsBefore).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)

    await owner.transaction().execute(upAll)

    expect(await snapshot(owner)).toEqual(schemaBefore)
    expect(await rowCounts(owner)).toEqual(countsBefore)
  })

  it('also holds when each migration runs on its own connection rather than one transaction', async () => {
    const schemaBefore = await snapshot(owner)
    for (const name of NAMES) await MIGRATIONS[name]!.up(owner)
    expect(await snapshot(owner)).toEqual(schemaBefore)
  })

  // One case per migration, so a failure names the migration that takes the lock.
  it.each(NAMES)('%s takes no lock that stops other sessions reading or writing a table', async (name) => {
    await owner.transaction().execute(async (trx) => {
      await MIGRATIONS[name]!.up(trx)
      const held = await sql<{ rel: string; mode: string }>`
        SELECT l.relation::regclass::text AS rel, l.mode
        FROM pg_locks l
        JOIN pg_class c ON c.oid = l.relation
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE l.pid = pg_backend_pid() AND l.granted AND ${SCOPE}
          AND l.mode = ANY(${BLOCKING_MODES})`.execute(trx)
      expect(held.rows).toEqual([])
    })
  })

  it('lets a request read and write while a re-run is open', async () => {
    const userId = await seed()
    const release = Promise.withResolvers<void>()
    const running = Promise.withResolvers<void>()
    const rerun = owner.transaction().execute(async (trx) => {
      await upAll(trx)
      running.resolve()
      await release.promise
    })
    await running.promise
    try {
      const seen = await asUser(h.db, userId, async (trx) => {
        // Fail fast rather than wait: a blocked reader would hang until the re-run commits.
        await sql`SET LOCAL lock_timeout = '1s'`.execute(trx)
        const out: number[] = []
        for (const table of ['core.accounts', 'core.transactions', 'core.categories']) {
          const r = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.raw(table)}`.execute(trx)
          out.push(Number(r.rows[0]?.n))
        }
        await sql`UPDATE core.categories SET sort_order = sort_order WHERE user_id = ${userId}`.execute(trx)
        return out
      })
      expect(seen.every((n) => n > 0)).toBe(true)
    } finally {
      release.resolve()
      await rerun
    }
  })
})

describe('reapplyAll', () => {
  it('re-runs every migration in order and leaves the bookkeeping table alone', async () => {
    const before = await snapshot(owner)
    const names = await reapplyAll(owner)
    expect(names).toEqual(NAMES)
    expect(await snapshot(owner)).toEqual(before)
  })

  it('repairs drift: a dropped index, an unforced table, a dropped policy and a revoked grant', async () => {
    const before = await snapshot(owner)
    await sql`DROP INDEX core.ix_transactions_user_amount`.execute(owner)
    await sql`ALTER TABLE core.accounts NO FORCE ROW LEVEL SECURITY`.execute(owner)
    await sql`DROP POLICY recurring_items_isolation ON core.recurring_items`.execute(owner)
    const role = sql.raw(process.env['APP_DB_ROLE'] ?? 'wickermoney_app_test')
    await sql`REVOKE DELETE ON core.plugins FROM ${role}`.execute(owner)
    expect(await snapshot(owner)).not.toEqual(before)

    await reapplyAll(owner)

    expect(await snapshot(owner)).toEqual(before)
  })
})
