import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import type { Executor } from './support/index.js'
import { down, FIRST_OWNER_LOCK_KEY, up } from './026_first_user_owner.js'

/**
 * Migration 026: the first account is the owner, every later one a member,
 * and two first registrations racing each other produce exactly one owner.
 *
 * The test database is shared and already holds owners from other suites.
 * Tests that need "no owner yet" demote those owners, run, and promote them
 * back (see {@link withNoOwners}); suites run one file at a time, so nothing
 * else observes the gap. `down` is tested inside a transaction that is rolled
 * back, so every other suite keeps the migrated function.
 */

let h: Harness
let admin: Db

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

const email = (): string => `owner-test-${randomUUID()}@example.com`

/** Calls the registration function directly, as the API's repository does. */
async function registerRaw(db: Executor, address = email()): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM core.register_user(${address}, 'not-a-real-digest')
  `.execute(db)
  const id = rows[0]?.id
  if (id === undefined) throw new Error('register_user returned no row')
  return id
}

async function roleOf(db: Executor, id: string): Promise<string | undefined> {
  const { rows } = await sql<{ role: string }>`SELECT role::text AS role FROM core.users WHERE id = ${id}`.execute(db)
  return rows[0]?.role
}

async function roleDefault(db: Executor): Promise<string | null> {
  const { rows } = await sql<{ d: string | null }>`
    SELECT column_default AS d FROM information_schema.columns
    WHERE table_schema = 'core' AND table_name = 'users' AND column_name = 'role'
  `.execute(db)
  return rows[0]?.d ?? null
}

async function functionTakesLock(db: Executor): Promise<boolean> {
  const { rows } = await sql<{ def: string }>`
    SELECT pg_get_functiondef('core.register_user(text, text)'::regprocedure) AS def
  `.execute(db)
  return rows[0]?.def.includes('pg_advisory_xact_lock') === true
}

/**
 * Runs `fn` on an instance with no owner: every current owner is demoted
 * first and promoted back afterwards, whatever happens.
 */
async function withNoOwners(fn: () => Promise<void>): Promise<void> {
  const { rows } = await sql<{ id: string }>`
    UPDATE core.users SET role = 'member' WHERE role = 'owner' RETURNING id
  `.execute(admin)
  const owners = rows.map((r) => r.id)
  try {
    await fn()
  } finally {
    if (owners.length > 0) {
      await sql`UPDATE core.users SET role = 'owner' WHERE id = ANY(${owners}::uuid[])`.execute(admin)
    }
  }
}

/** Registers through the real endpoint and returns the user from the response. */
async function registerViaApi(): Promise<{ id: string; role: string }> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: email(), password: 'correct-horse-battery-staple' },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { user: { id: string; role: string } }).user
}

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await admin.destroy()
  await h.close()
})

describe('registration after the migration', () => {
  it('makes the first account the owner and every later one a member', async () => {
    await withNoOwners(async () => {
      const first = await registerViaApi()
      const second = await registerViaApi()
      const third = await registerViaApi()
      expect([first.role, second.role, third.role]).toEqual(['owner', 'member', 'member'])
      expect(await roleOf(admin, first.id)).toBe('owner')
      expect(await roleOf(admin, second.id)).toBe('member')
    })
  })

  it('makes a newcomer a member while an owner exists', async () => {
    // The shared database already holds owners from other suites.
    expect((await registerViaApi()).role).toBe('member')
  })

  it('reports the role on sign-in, refresh and /auth/me as well', async () => {
    const address = email()
    const password = 'correct-horse-battery-staple'
    await h.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: address, password } })

    const login = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: address, password } })
    expect(login.json().user.role).toBe('member')

    const token = (login.json() as { accessToken: string }).accessToken
    const me = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(me.json()).toMatchObject({ email: address, role: 'member' })

    const cookie = login.cookies.find((c) => c.name === 'wickermoney_refresh')
    const refreshed = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      headers: { 'x-wickermoney-csrf': '1' }, cookies: { wickermoney_refresh: cookie?.value ?? '' },
    })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json().user.role).toBe('member')

    // Promoted by hand: the next response says so without a new sign-in.
    await sql`UPDATE core.users SET role = 'owner' WHERE email = ${address}`.execute(admin)
    const again = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(again.json().role).toBe('owner')
    await sql`UPDATE core.users SET role = 'member' WHERE email = ${address}`.execute(admin)
  })

  it('gives a second first registration that waits on the first the member role', async () => {
    await withNoOwners(async () => {
      let second: Promise<string> | undefined
      let firstId = ''
      await admin.transaction().execute(async (trx) => {
        // The first registration holds the lock and its uncommitted owner row.
        firstId = await registerRaw(trx)
        second = registerRaw(h.db)

        // Wait until the second is provably blocked on the same lock, so the
        // test exercises the race rather than two registrations in sequence.
        for (let i = 0; ; i += 1) {
          const { rows } = await sql<{ n: number }>`
            SELECT count(*)::int AS n FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted
              AND ((classid::bigint << 32) | objid::bigint) = ${FIRST_OWNER_LOCK_KEY}::bigint
          `.execute(admin)
          if ((rows[0]?.n ?? 0) > 0) break
          if (i > 200) throw new Error('the second registration never waited on the lock')
          await new Promise((r) => setTimeout(r, 10))
        }
      })

      const secondId = await second!
      expect(await roleOf(admin, firstId)).toBe('owner')
      expect(await roleOf(admin, secondId)).toBe('member')
    })
  })

  it('produces exactly one owner from a burst of simultaneous first registrations', async () => {
    await withNoOwners(async () => {
      const users = await Promise.all(Array.from({ length: 12 }, () => registerViaApi()))
      expect(users.filter((u) => u.role === 'owner')).toHaveLength(1)
      const ids = users.map((u) => u.id)
      const { rows } = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM core.users WHERE id = ANY(${ids}::uuid[]) AND role = 'owner'
      `.execute(admin)
      expect(rows[0]?.n).toBe(1)
    })
  })
})

describe('the migration itself', () => {
  it('sets the column default to member and installs the locking function', async () => {
    expect(await roleDefault(admin)).toContain('member')
    expect(await functionTakesLock(admin)).toBe(true)
  })

  it('is a no-op on a second run', async () => {
    await up(admin)
    expect(await roleDefault(admin)).toContain('member')
    expect(await functionTakesLock(admin)).toBe(true)
  })

  it('leaves existing owners as owners when it runs on an instance that has several', async () => {
    await expect(admin.transaction().execute(async (trx) => {
      await down(trx)
      // Under the old rules every account is an owner.
      const a = await registerRaw(trx)
      const b = await registerRaw(trx)
      expect([await roleOf(trx, a), await roleOf(trx, b)]).toEqual(['owner', 'owner'])

      await up(trx)
      expect([await roleOf(trx, a), await roleOf(trx, b)]).toEqual(['owner', 'owner'])
      // ...and the next account is a member, because owners exist.
      expect(await roleOf(trx, await registerRaw(trx))).toBe('member')
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
  })

  it('down restores the owner default and the old function, and up brings the new ones back', async () => {
    await expect(admin.transaction().execute(async (trx) => {
      await down(trx)
      expect(await roleDefault(trx)).toContain('owner')
      expect(await functionTakesLock(trx)).toBe(false)
      expect(await roleOf(trx, await registerRaw(trx))).toBe('owner')

      await up(trx)
      expect(await roleDefault(trx)).toContain('member')
      expect(await functionTakesLock(trx)).toBe(true)
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
    expect(await functionTakesLock(admin)).toBe(true)
  })

  it('keeps the function executable by the application role only', async () => {
    const { rows } = await sql<{ public: boolean }>`
      SELECT has_function_privilege('public', 'core.register_user(text, text)', 'EXECUTE') AS public
    `.execute(admin)
    expect(rows[0]?.public).toBe(false)
  })
})
