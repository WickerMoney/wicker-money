import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asSystem, asUser, createDb, type Db } from './client.js'
import { configureTenantContext } from './configureTenantContext.js'
import { signTenantContext } from './signTenantContext.js'
import { deriveTenantContextKey } from './deriveTenantContextKey.js'
import {
  createHarness,
  createUser,
  TEST_AUTH_SECRET,
  TEST_DATABASE_URL,
  type Harness,
  type TestUser,
} from '../testing/harness.js'

/**
 * Tables that carry per-user data but deliberately do not FORCE row-level
 * security, and why.
 *
 * `core.users` and `core.sessions` are read and written before any user is
 * known (register, login, refresh) by SECURITY DEFINER functions. Those run
 * with the privileges of the table owner, and FORCE would strip the owner's
 * exemption from the policies and make the functions unable to see the rows.
 * The application role owns nothing, so ENABLE still binds it in full; startup
 * refuses to run as the owner or a superuser.
 */
const NOT_FORCED = new Set(['core.users', 'core.sessions'])

/** A base table in `core` or a `plugin_*` schema, with its row-level-security state. */
interface TableState {
  readonly name: string
  readonly hasUserColumn: boolean
  readonly rlsEnabled: boolean
  readonly rlsForced: boolean
  readonly policies: number
  readonly ownedByCurrentRole: boolean
}

let db: Db
let tables: readonly TableState[]

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL)
  const { rows } = await sql<{
    name: string
    has_user_column: boolean
    rls_enabled: boolean
    rls_forced: boolean
    policies: string
    owned_by_current_role: boolean
  }>`
    SELECT n.nspname || '.' || c.relname AS name,
           EXISTS (
             SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
           ) AS has_user_column,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
           pg_get_userbyid(c.relowner) = current_user AS owned_by_current_role
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND (n.nspname = 'core' OR n.nspname LIKE 'plugin\_%')
    ORDER BY 1
  `.execute(db)
  tables = rows.map((r) => ({
    name: r.name,
    hasUserColumn: r.has_user_column,
    rlsEnabled: r.rls_enabled,
    rlsForced: r.rls_forced,
    policies: Number(r.policies),
    ownedByCurrentRole: r.owned_by_current_role,
  }))
})

afterAll(async () => {
  await db.destroy()
})

describe('row-level security invariants', () => {
  it('finds the tables it is meant to police', () => {
    // Guards against the catalog query silently matching nothing.
    const owned = tables.filter((t) => t.hasUserColumn).map((t) => t.name)
    expect(owned).toEqual(
      expect.arrayContaining(['core.accounts', 'core.transactions', 'core.sessions']),
    )
    expect(owned.some((n) => n.startsWith('plugin_'))).toBe(true)
  })

  it('enables row-level security and defines a policy on every table with a user_id column', () => {
    const offenders = tables
      .filter((t) => t.hasUserColumn && (!t.rlsEnabled || t.policies === 0))
      .map((t) => t.name)
    expect(offenders).toEqual([])
  })

  it('forces row-level security on all of them except the documented allow-list', () => {
    const offenders = tables
      .filter((t) => t.hasUserColumn && !t.rlsForced && !NOT_FORCED.has(t.name))
      .map((t) => t.name)
    expect(offenders).toEqual([])
  })

  it('keeps the allow-list honest: every entry exists and really is unforced', () => {
    for (const name of NOT_FORCED) {
      const table = tables.find((t) => t.name === name)
      expect(table, `${name} should exist`).toBeDefined()
      expect(table?.rlsEnabled, `${name} should have RLS enabled`).toBe(true)
      expect(table?.policies, `${name} should have a policy`).toBeGreaterThan(0)
      // If FORCE were added later this entry would be stale and hide nothing.
      expect(table?.rlsForced, `${name} is forced; remove it from the allow-list`).toBe(false)
    }
  })

  it('enables row-level security with a policy on core.users, which is keyed by id rather than user_id', () => {
    const users = tables.find((t) => t.name === 'core.users')
    expect(users).toMatchObject({ rlsEnabled: true })
    expect(users?.policies).toBeGreaterThan(0)
  })

  it('does not let the application role own any of these tables', () => {
    // An owner is exempt from the policies of every table that is not forced.
    expect(tables.filter((t) => t.ownedByCurrentRole).map((t) => t.name)).toEqual([])
  })

  it('shows the application role no user or session rows without a user context', async () => {
    const counts = await asSystem(db, async (trx) => {
      const users = await sql<{ n: string }>`SELECT count(*) AS n FROM core.users`.execute(trx)
      const sessions = await sql<{ n: string }>`SELECT count(*) AS n FROM core.sessions`.execute(trx)
      return [Number(users.rows[0]?.n), Number(sessions.rows[0]?.n)]
    })
    expect(counts).toEqual([0, 0])
  })
})

describe('signed tenant context on every policy-protected table', () => {
  let h: Harness
  let victim: TestUser
  let policyTables: readonly string[]

  beforeAll(async () => {
    h = await createHarness()
    configureTenantContext(TEST_AUTH_SECRET)
    victim = await createUser(h)
    await asUser(h.db, victim.id, async (trx) => {
      const account = await sql<{ id: string }>`
        INSERT INTO core.accounts (user_id, name, account_type) VALUES (${victim.id}, 'Victim', 'checking') RETURNING id
      `.execute(trx)
      await sql`
        INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date)
        VALUES (${victim.id}, ${account.rows[0]!.id}, -1, 'VICTIM', CURRENT_DATE)
      `.execute(trx)
      await sql`INSERT INTO core.categories (user_id, name, slug) VALUES (${victim.id}, 'Victim', 'victim')`.execute(trx)
    })
    const { rows } = await sql<{ name: string }>`
      SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS name FROM pg_policies ORDER BY 1
    `.execute(h.db)
    policyTables = rows.map((r) => r.name)
  })

  afterAll(async () => {
    await h.close()
  })

  /** Row count of `table` as the application role under the given raw settings. */
  async function rowsVisible(table: string, userId: string, signature: string | null): Promise<number> {
    return h.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx)
      if (signature !== null) await sql`SELECT set_config('app.user_sig', ${signature}, true)`.execute(trx)
      const r = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.raw(table)}`.execute(trx)
      return Number(r.rows[0]?.n)
    })
  }

  it('covers the core tables and the plugin tables', () => {
    expect(policyTables).toEqual(
      expect.arrayContaining(['core.accounts', 'core.transactions', 'core.users', 'core.sessions']),
    )
    expect(policyTables.some((t) => t.startsWith('plugin_'))).toBe(true)
  })

  it('shows no rows for a forged, missing or garbage signature, on every table', async () => {
    const own = signTenantContext(deriveTenantContextKey(TEST_AUTH_SECRET), victim.id)
    const stranger = signTenantContext(deriveTenantContextKey(TEST_AUTH_SECRET), '00000000-0000-4000-8000-000000000001')
    const forged: Array<string | null> = [null, '', 'garbage', '0'.repeat(64), stranger, own.slice(0, 63), own.toUpperCase()]

    const withSignature = await Promise.all(policyTables.map((t) => rowsVisible(t, victim.id, own)))
    // The victim genuinely has rows somewhere, so "zero" below cannot be an empty database.
    expect(withSignature.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)

    const leaks: string[] = []
    for (const table of policyTables) {
      for (const signature of forged) {
        if ((await rowsVisible(table, victim.id, signature)) !== 0) {
          leaks.push(`${table} with signature ${JSON.stringify(signature)}`)
        }
      }
    }
    expect(leaks).toEqual([])
  })
})
