import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asPlugin, asUser, createDb, type Db } from './client.js'
import { configureTenantContext } from './configureTenantContext.js'
import { deriveTenantContextKey } from './deriveTenantContextKey.js'
import { assertSchemaReady } from './healthcheck.js'
import { installTenantContextKey } from './installTenantContextKey.js'
import { down, up } from './migrations/018_tenant_context_signature.js'
import { pluginRoleName } from './plugin-roles.js'
import { signTenantContext } from './signTenantContext.js'
import type { Trx } from './Trx.js'
import {
  createHarness,
  createUser,
  TEST_ADMIN_DATABASE_URL,
  TEST_AUTH_SECRET,
  type Harness,
  type TestUser,
} from '../testing/harness.js'

const BUDGETS_ROLE = pluginRoleName('wickermoney.budgets')
const KEY = deriveTenantContextKey(TEST_AUTH_SECRET)

let h: Harness
let admin: Db
let alice: TestUser
let bob: TestUser

/** Inserts an account and a transaction owned by `user`, returning the merchant name used. */
async function seed(user: TestUser, merchant: string): Promise<void> {
  await asUser(h.db, user.id, async (trx) => {
    const account = await sql<{ id: string }>`
      INSERT INTO core.accounts (user_id, name, account_type)
      VALUES (${user.id}, ${`Checking ${merchant}`}, 'checking') RETURNING id
    `.execute(trx)
    await sql`
      INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date)
      VALUES (${user.id}, ${account.rows[0]!.id}, -12.5, ${merchant}, CURRENT_DATE)
    `.execute(trx)
  })
}

/** Runs `fn` as the application role in a transaction with the given raw settings and no signing. */
async function withSettings<T>(
  userId: string | null,
  signature: string | null,
  fn: (trx: Trx) => Promise<T>,
): Promise<T> {
  return h.db.transaction().execute(async (trx) => {
    if (userId !== null) await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx)
    if (signature !== null) await sql`SELECT set_config('app.user_sig', ${signature}, true)`.execute(trx)
    return fn(trx)
  })
}

/** Number of transactions belonging to `user` that the current transaction can see. */
async function visibleTransactions(trx: Trx, user: TestUser): Promise<number> {
  const r = await sql<{ n: string }>`
    SELECT count(*) AS n FROM core.transactions WHERE user_id = ${user.id}
  `.execute(trx)
  return Number(r.rows[0]?.n)
}

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  alice = await createUser(h)
  bob = await createUser(h)
  await seed(alice, 'ALICE-COFFEE')
  await seed(bob, 'BOB-SECRET')
})

afterAll(async () => {
  configureTenantContext(TEST_AUTH_SECRET)
  await installTenantContextKey(admin)
  await admin.destroy()
  await h.close()
})

describe('a plugin that escapes its role cannot switch tenant', () => {
  it('reads nothing of bob after RESET ROLE and a rewritten app.user_id, whatever the signature', async () => {
    const attempts = await asPlugin(h.db, BUDGETS_ROLE, alice.id, async (trx) => {
      const seen: Record<string, number> = {}
      await sql`RESET ROLE`.execute(trx)
      const [who] = (await sql<{ role: string }>`SELECT current_user::text AS role`.execute(trx)).rows
      seen['role'] = who?.role === BUDGETS_ROLE ? 1 : 0

      const ownSig = (await sql<{ s: string }>`SELECT current_setting('app.user_sig') AS s`.execute(trx)).rows[0]!.s
      const forged: Array<[string, string | null]> = [
        ['no signature change', null],
        ['empty', ''],
        ['garbage', 'not-a-signature'],
        ['guessed zeros', '0'.repeat(64)],
        ["alice's own signature", ownSig],
        ['uppercased', ownSig.toUpperCase()],
      ]
      for (const [label, sig] of forged) {
        await sql`SELECT set_config('app.user_id', ${bob.id}, true)`.execute(trx)
        if (sig !== null) await sql`SELECT set_config('app.user_sig', ${sig}, true)`.execute(trx)
        seen[label] = await visibleTransactions(trx, bob)
      }
      // The escape did regain the app role's privileges over alice's own rows;
      // that is the documented residual, but it must stay confined to alice.
      await sql`SELECT set_config('app.user_id', ${alice.id}, true)`.execute(trx)
      await sql`SELECT set_config('app.user_sig', ${ownSig}, true)`.execute(trx)
      seen['alice still'] = await visibleTransactions(trx, alice)
      return seen
    })
    expect(attempts).toEqual({
      role: 0, // RESET ROLE really did leave the plugin role, so the test is not vacuous
      'no signature change': 0,
      empty: 0,
      garbage: 0,
      'guessed zeros': 0,
      "alice's own signature": 0,
      uppercased: 0,
      'alice still': 1,
    })
  })

  it('reads nothing of bob when the plugin only rewrites the settings, without RESET ROLE', async () => {
    const n = await asPlugin(h.db, BUDGETS_ROLE, alice.id, async (trx) => {
      await sql`SELECT set_config('app.user_id', ${bob.id}, true)`.execute(trx)
      return visibleTransactions(trx, bob)
    })
    expect(n).toBe(0)
  })

  it('reads nothing of bob for a signature computed from the wrong key', async () => {
    const wrong = signTenantContext(deriveTenantContextKey('another-secret-that-is-long-enough-000'), bob.id)
    expect(await withSettings(bob.id, wrong, (trx) => visibleTransactions(trx, bob))).toBe(0)
  })

  it('does show bob his rows for a correctly signed context, so the zero rows above are the signature at work', async () => {
    const good = signTenantContext(KEY, bob.id)
    expect(await withSettings(bob.id, good, (trx) => visibleTransactions(trx, bob))).toBe(1)
    expect(await asUser(h.db, bob.id, (trx) => visibleTransactions(trx, bob))).toBe(1)
    expect(await asPlugin(h.db, BUDGETS_ROLE, bob.id, (trx) => visibleTransactions(trx, bob))).toBe(1)
  })

  it('cannot be defeated by shadowing functions in pg_temp or changing search_path', async () => {
    const n = await asPlugin(h.db, BUDGETS_ROLE, alice.id, async (trx) => {
      await sql`RESET ROLE`.execute(trx)
      await sql`
        CREATE FUNCTION pg_temp.sha256(bytea) RETURNS bytea LANGUAGE sql AS $$ SELECT '\\x00'::bytea $$
      `.execute(trx)
      await sql`SET LOCAL search_path = pg_temp, public`.execute(trx)
      await sql`SELECT set_config('app.user_id', ${bob.id}, true)`.execute(trx)
      await sql`SELECT set_config('app.user_sig', ${'00'.repeat(32)}, true)`.execute(trx)
      return visibleTransactions(trx, bob)
    })
    expect(n).toBe(0)
  })
})

describe('core.current_user_id', () => {
  it('returns the id for a valid signature and NULL otherwise, never raising', async () => {
    const id = randomUUID()
    const good = signTenantContext(KEY, id)
    const read = (uid: string | null, sig: string | null) =>
      withSettings(uid, sig, async (trx) =>
        (await sql<{ v: string | null }>`SELECT core.current_user_id()::text AS v`.execute(trx)).rows[0]!.v,
      )
    expect(await read(id, good)).toBe(id)
    expect(await read(id, null)).toBeNull()
    expect(await read(null, good)).toBeNull()
    expect(await read(null, null)).toBeNull()
    expect(await read(id, '')).toBeNull()
    expect(await read(id, good.slice(1))).toBeNull()
    expect(await read(id, `${good}00`)).toBeNull()
    expect(await read(id, 'zz'.repeat(32))).toBeNull()
    expect(await read('not-a-uuid', signTenantContext(KEY, 'not-a-uuid'))).toBeNull()
    expect(await read(`${id}'; DROP TABLE core.users; --`, good)).toBeNull()
    expect(await read(randomUUID(), good)).toBeNull()
  })

  it('does not care about the case of a signed id, which is still the same tenant', async () => {
    const id = randomUUID().toUpperCase()
    const v = await withSettings(id, signTenantContext(KEY, id), async (trx) =>
      (await sql<{ v: string | null }>`SELECT core.current_user_id()::text AS v`.execute(trx)).rows[0]!.v,
    )
    expect(v).toBe(id.toLowerCase())
  })

  it('is a STABLE security-definer function, so it is evaluated once per statement', async () => {
    const { rows } = await sql<{ provolatile: string; prosecdef: boolean }>`
      SELECT provolatile, prosecdef FROM pg_proc WHERE proname = 'current_user_id'
    `.execute(h.db)
    expect(rows).toEqual([{ provolatile: 's', prosecdef: true }])
  })
})

describe('row-level security plans', () => {
  it('evaluates the signed lookup once per statement (an InitPlan) and still uses the user index', async () => {
    const plan = await asUser(h.db, alice.id, async (trx) => {
      await sql`SET LOCAL enable_seqscan = off`.execute(trx)
      const r = await sql<{ line: string }>`
        EXPLAIN (COSTS OFF) SELECT * FROM core.transactions ORDER BY transaction_date DESC LIMIT 10
      `.execute(trx)
      return r.rows.map((row) => Object.values(row)[0] as string).join('\n')
    })
    expect(plan).toMatch(/InitPlan/)
    expect(plan).toMatch(/Index Cond: \(user_id = \$\d+\)/)
    expect(plan).not.toMatch(/Filter: .*current_user_id/)
  })
})

describe('the signing key', () => {
  const secrets = ['core.tenant_context_key']

  it('cannot be read or written by the application role or any plugin role', async () => {
    const roles = await sql<{ rolname: string }>`
      SELECT rolname FROM pg_roles WHERE rolname LIKE ${`${process.env['APP_DB_ROLE'] ?? 'wickermoney_app_test'}%`}
    `.execute(admin)
    expect(roles.rows.length).toBeGreaterThan(1)
    for (const { rolname } of roles.rows) {
      for (const table of secrets) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES']) {
          const r = await sql<{ ok: boolean }>`
            SELECT has_table_privilege(${rolname}, ${table}, ${privilege}) AS ok
          `.execute(admin)
          expect(r.rows[0]?.ok, `${rolname} ${privilege} ${table}`).toBe(false)
        }
      }
      const fn = await sql<{ ok: boolean }>`
        SELECT has_function_privilege(${rolname}, 'core.install_tenant_context_key(bytea)', 'EXECUTE') AS ok
      `.execute(admin)
      expect(fn.rows[0]?.ok, `${rolname} EXECUTE install_tenant_context_key`).toBe(false)
    }
  })

  it('is refused with permission errors when a plugin, even after RESET ROLE, tries to read or replace it', async () => {
    await asPlugin(h.db, BUDGETS_ROLE, alice.id, async (trx) => {
      await sql`RESET ROLE`.execute(trx)
      for (const attempt of [
        sql`SELECT key FROM core.tenant_context_key`,
        sql`UPDATE core.tenant_context_key SET key = '\\x00'::bytea`,
        sql`SELECT core.install_tenant_context_key(decode(repeat('00', 32), 'hex'))`,
      ]) {
        await sql`SAVEPOINT s`.execute(trx)
        await expect(attempt.execute(trx)).rejects.toThrow(/permission denied/i)
        await sql`ROLLBACK TO SAVEPOINT s`.execute(trx)
      }
    })
  })

  it('leaves every tenant with zero rows, and raises nothing, when no key is installed', async () => {
    await sql`DELETE FROM core.tenant_context_key`.execute(admin)
    try {
      expect(await asUser(h.db, alice.id, (trx) => visibleTransactions(trx, alice))).toBe(0)
      expect(await asPlugin(h.db, BUDGETS_ROLE, alice.id, (trx) => visibleTransactions(trx, alice))).toBe(0)
      await expect(assertSchemaReady(h.db)).rejects.toThrow(/pnpm --filter @wickermoney\/api migrate/)
    } finally {
      await installTenantContextKey(admin)
    }
    expect(await asUser(h.db, alice.id, (trx) => visibleTransactions(trx, alice))).toBe(1)
  })

  it('can be re-installed, and a re-run of the installer keeps a single row', async () => {
    await installTenantContextKey(admin)
    await installTenantContextKey(admin)
    const r = await sql<{ n: string }>`SELECT count(*) AS n FROM core.tenant_context_key`.execute(admin)
    expect(Number(r.rows[0]?.n)).toBe(1)
  })
})

describe('assertSchemaReady and the signing key', () => {
  it('passes when the database key matches AUTH_SECRET', async () => {
    await expect(assertSchemaReady(h.db)).resolves.toBeUndefined()
  })

  it('fails with an actionable message when AUTH_SECRET no longer matches the installed key', async () => {
    configureTenantContext('a-rotated-secret-that-is-comfortably-long-000')
    try {
      const failure = await assertSchemaReady(h.db).catch((e: unknown) => e as Error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toMatch(/does not match AUTH_SECRET/)
      expect((failure as Error).message).toMatch(/pnpm --filter @wickermoney\/api migrate/)
    } finally {
      configureTenantContext(TEST_AUTH_SECRET)
    }
    await expect(assertSchemaReady(h.db)).resolves.toBeUndefined()
  })

  it('refuses to start if core.current_user_id() would accept an unsigned id', async () => {
    await down(admin)
    try {
      await expect(assertSchemaReady(h.db)).rejects.toThrow(/accepts an unsigned user id/)
    } finally {
      await up(admin)
      await installTenantContextKey(admin)
    }
    await expect(assertSchemaReady(h.db)).resolves.toBeUndefined()
  })

  it('refuses to start if the application role could read the key', async () => {
    await sql`GRANT SELECT ON core.tenant_context_key TO ${sql.raw(process.env['APP_DB_ROLE'] ?? 'wickermoney_app_test')}`.execute(admin)
    try {
      await expect(assertSchemaReady(h.db)).rejects.toThrow(/can read core\.tenant_context_key/)
    } finally {
      await sql`REVOKE ALL ON core.tenant_context_key FROM ${sql.raw(process.env['APP_DB_ROLE'] ?? 'wickermoney_app_test')}`.execute(admin)
    }
  })
})
