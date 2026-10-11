import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asSystem, asUser, createDb, type Db } from '../client.js'
import { bindTenantContext } from '../bindTenantContext.js'
import { pluginRoleName } from '../plugin-roles.js'
import { BUNDLED_PLUGINS } from '../../plugins/bundled.js'
import { TEST_APP_ROLE, TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser } from '../../testing/harness.js'
import { familyIdOf, rowsOwnedBy, setRole, userTables } from '../../testing/userData.js'
import type { Trx } from '../Trx.js'
import { down, up } from './031_erase_instance.js'

/**
 * Migration 031: `core.erase_instance` and `core.instance_activity`.
 *
 * Nothing here commits an erase. The destructive calls run inside a
 * transaction that is rolled back after the assertions, so every other suite
 * keeps the users it created. The route-level erase, which does commit, lives
 * in its own file (`settings/eraseInstance.integration.test.ts`).
 */

let h: Harness
let admin: Db

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

/** Runs `work` in a transaction on the application connection and always rolls it back. */
async function rolledBack(work: (trx: Trx) => Promise<void>): Promise<void> {
  try {
    await h.db.transaction().execute(async (trx) => {
      await work(trx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}

async function owner(): Promise<TestUser> {
  const user = await createUser(h)
  await setRole(admin, user.id, 'owner')
  return user
}

async function member(): Promise<TestUser> {
  const user = await createUser(h)
  await setRole(admin, user.id, 'member')
  return user
}

/** Gives `user` an account, so an erase has something to remove. */
async function giveSomeData(user: TestUser): Promise<void> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user), payload: { name: 'Checking', accountType: 'checking' },
  })
  expect(res.statusCode).toBe(201)
}

async function activity(trx: Trx, exclude: string | null): Promise<{ sessions: number; users: number }> {
  const { rows } = await sql<{ other_sessions: string; other_users: string }>`
    SELECT * FROM core.instance_activity(${exclude}::uuid)
  `.execute(trx)
  return { sessions: Number(rows[0]?.other_sessions), users: Number(rows[0]?.other_users) }
}

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await admin.destroy()
  await h.close()
})

describe('who may call the functions', () => {
  it('is executable by the application role and by no one else', async () => {
    const roles = [TEST_APP_ROLE, ...BUNDLED_PLUGINS.map((m) => pluginRoleName(m.id))]
    const { rows } = await sql<{ role: string; erase: boolean; activity: boolean }>`
      SELECT r.rolname AS role,
             has_function_privilege(r.rolname, 'core.erase_instance()', 'EXECUTE') AS erase,
             has_function_privilege(r.rolname, 'core.instance_activity(uuid)', 'EXECUTE') AS activity
      FROM pg_roles r WHERE r.rolname = ANY(${roles})
    `.execute(admin)
    const byRole = Object.fromEntries(rows.map((r) => [r.role, r]))
    expect(byRole[TEST_APP_ROLE]).toMatchObject({ erase: true, activity: true })
    for (const [role, row] of Object.entries(byRole)) {
      if (role !== TEST_APP_ROLE) expect(row, role).toMatchObject({ erase: false, activity: false })
    }
    const { rows: pub } = await sql<{ erase: boolean; activity: boolean }>`
      SELECT has_function_privilege('public', 'core.erase_instance()', 'EXECUTE') AS erase,
             has_function_privilege('public', 'core.instance_activity(uuid)', 'EXECUTE') AS activity
    `.execute(admin)
    expect(pub[0]).toEqual({ erase: false, activity: false })
  })

  it('refuses a member, with insufficient_privilege', async () => {
    const m = await member()
    await expect(asUser(h.db, m.id, (trx) => sql`SELECT core.erase_instance()`.execute(trx)))
      .rejects.toMatchObject({ code: '42501' })
    await expect(asUser(h.db, m.id, (trx) => sql`SELECT * FROM core.instance_activity(NULL)`.execute(trx)))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a call that carries no signed user at all', async () => {
    await expect(asSystem(h.db, (trx) => sql`SELECT core.erase_instance()`.execute(trx)))
      .rejects.toMatchObject({ code: '42501' })
    await expect(asSystem(h.db, (trx) => sql`SELECT * FROM core.instance_activity(NULL)`.execute(trx)))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('refuses an owner id that is not signed, so the id alone proves nothing', async () => {
    const o = await owner()
    await expect(h.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${o.id}, true), set_config('app.user_sig', 'forged', true)`.execute(trx)
      await sql`SELECT core.erase_instance()`.execute(trx)
    })).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses an account demoted since it signed in', async () => {
    const o = await owner()
    await setRole(admin, o.id, 'member')
    await expect(asUser(h.db, o.id, (trx) => sql`SELECT core.erase_instance()`.execute(trx)))
      .rejects.toMatchObject({ code: '42501' })
  })
})

describe('core.erase_instance', () => {
  it('empties every user-data table for every user, and leaves instance configuration alone', async () => {
    const boss = await owner()
    const a = await member()
    const b = await member()
    await giveSomeData(a)
    await giveSomeData(b)

    const tables = await userTables(h.db)
    expect(tables.length).toBeGreaterThan(10)
    const pluginsBefore = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.plugins`.execute(admin)).rows[0]?.n

    await rolledBack(async (trx) => {
      // Before: rows exist for each user. Row-level security shows each user
      // only their own, so look from each user's side in turn.
      for (const u of [a, b]) {
        await bindTenantContext(trx, u.id)
        expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.accounts`.execute(trx)).rows[0]?.n).toBe(1)
        expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.sessions`.execute(trx)).rows[0]?.n).toBeGreaterThan(0)
      }

      await bindTenantContext(trx, boss.id)
      await sql`SELECT core.erase_instance()`.execute(trx)

      // After: nothing for any of them, the owner's own account row included.
      for (const u of [boss, a, b]) {
        await bindTenantContext(trx, u.id)
        for (const table of tables) {
          const { rows } = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(trx)
          expect(rows[0]?.n, `${table} for ${u.email}`).toBe(0)
        }
        expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.users`.execute(trx)).rows[0]?.n).toBe(0)
      }
      expect((await sql<{ has: boolean }>`SELECT core.instance_has_users() AS has`.execute(trx)).rows[0]?.has).toBe(false)
    })

    // Rolled back: nothing was lost, and what the erase never touches is still there.
    expect((await rowsOwnedBy(h.db, a.id))['core.accounts']).toBe(1)
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.plugins`.execute(admin)).rows[0]?.n).toBe(pluginsBefore)
  })

  it('can be run on an instance that is already empty', async () => {
    const boss = await owner()
    await rolledBack(async (trx) => {
      await bindTenantContext(trx, boss.id)
      await sql`SELECT core.erase_instance()`.execute(trx)
      // The caller is gone now, so a second call is refused rather than a no-op:
      // the function only answers an owner who exists.
      await expect(sql`SELECT core.erase_instance()`.execute(trx)).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('lets the first registration afterwards become the owner', async () => {
    const boss = await owner()
    await rolledBack(async (trx) => {
      await bindTenantContext(trx, boss.id)
      await sql`SELECT core.erase_instance()`.execute(trx)
      const { rows } = await sql<{ id: string }>`SELECT id FROM core.register_user('first-after-erase@example.com', 'x')`.execute(trx)
      const id = rows[0]?.id
      expect(id).toBeDefined()
      // The new account is only visible to itself.
      await bindTenantContext(trx, id as string)
      const role = await sql<{ role: string }>`SELECT role::text AS role FROM core.users WHERE id = ${id}::uuid`.execute(trx)
      expect(role.rows[0]?.role).toBe('owner')
    })
  })
})

describe('core.instance_activity', () => {
  it('counts live session families other than the one excluded, and the other accounts they belong to', async () => {
    const boss = await owner()
    const bossFamily = familyIdOf(boss.accessToken)
    const baseline = await asUser(h.db, boss.id, (trx) => activity(trx, bossFamily))
    const everything = await asUser(h.db, boss.id, (trx) => activity(trx, null))
    // Excluding the caller's family removes exactly that one session, and the
    // caller is never counted among "other accounts".
    expect(everything.sessions - baseline.sessions).toBe(1)
    expect(everything.users).toBe(baseline.users)

    const other = await member()
    const after = await asUser(h.db, boss.id, (trx) => activity(trx, bossFamily))
    expect(after.sessions - baseline.sessions).toBe(1)
    expect(after.users - baseline.users).toBe(1)

    // A second device of the same account is another session but not another account.
    const login = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: other.email, password: 'correct-horse-battery-staple' },
    })
    expect(login.statusCode).toBe(200)
    const twice = await asUser(h.db, boss.id, (trx) => activity(trx, bossFamily))
    expect(twice.sessions - after.sessions).toBe(1)
    expect(twice.users).toBe(after.users)
  })

  it('stops counting a session once it is revoked or has expired', async () => {
    const boss = await owner()
    const family = familyIdOf(boss.accessToken)
    const other = await member()
    const before = await asUser(h.db, boss.id, (trx) => activity(trx, family))

    await sql`UPDATE core.sessions SET revoked_at = now() WHERE user_id = ${other.id}::uuid`.execute(admin)
    const revoked = await asUser(h.db, boss.id, (trx) => activity(trx, family))
    expect(before.sessions - revoked.sessions).toBe(1)
    expect(before.users - revoked.users).toBe(1)

    const lapsed = await member()
    await sql`UPDATE core.sessions SET expires_at = now() - interval '1 minute' WHERE user_id = ${lapsed.id}::uuid`.execute(admin)
    expect(await asUser(h.db, boss.id, (trx) => activity(trx, family))).toEqual(revoked)
  })
})

describe('up and down', () => {
  it('can be re-run without changing anything, and down removes both functions', async () => {
    // Run as the owner, inside a transaction that is rolled back so other suites keep the functions.
    await admin.transaction().execute(async (trx) => {
      await up(trx)
      await up(trx)
      const present = async () => (await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'core' AND p.proname IN ('erase_instance', 'instance_activity')
      `.execute(trx)).rows[0]?.n
      expect(await present()).toBe(2)
      await down(trx)
      expect(await present()).toBe(0)
      throw new Rollback()
    }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error })
  })
})
