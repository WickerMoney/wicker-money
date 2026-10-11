import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { REFRESH_COOKIE_NAME } from '../auth/routes/helpers/REFRESH_COOKIE_NAME.js'
import { createDb, type Db } from '../db/client.js'
import { seedHousehold } from '../testing/eraseFixtures.js'
import {
  TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser,
} from '../testing/harness.js'
import { rowsOwnedBy, setRole } from '../testing/userData.js'

/**
 * "Erase this entire instance", end to end against real PostgreSQL.
 *
 * Unlike the rest of the suite these tests commit a real instance erase, so
 * every account that exists in the shared test database goes with it. That is
 * safe because each test file registers the users it needs; it is also why the
 * tests that only look (refusals, preflight) run before the ones that erase,
 * and why every erasing test builds its own owner first.
 */

const PASSWORD = 'correct-horse-battery-staple'
const URL = '/api/v1/settings/erase-instance'
const PHRASE = 'erase this instance'

let h: Harness
let admin: Db

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  const { seedBundledPlugins } = await import('../plugins/registry.js')
  await seedBundledPlugins(h.db)
})
afterAll(async () => {
  await admin.destroy()
  await h.close()
})

type App = Harness['app']

/** An owner, promoted as the database owner would (registration only makes the first account one). */
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

function erase(user: TestUser, payload: Record<string, unknown> = {}, app: App = h.app) {
  return app.inject({
    method: 'POST', url: URL, headers: auth(user),
    payload: { password: PASSWORD, confirmation: PHRASE, acknowledgeActiveSessions: true, ...payload },
  })
}

function check(user: TestUser, app: App = h.app) {
  return app.inject({ method: 'GET', url: URL, headers: auth(user) })
}

const me = (user: TestUser) =>
  h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(user) })

async function register(email: string, app: App = h.app) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, password: PASSWORD } })
  return res
}

/** The role a freshly registered address ended up with. */
async function roleOf(registration: Awaited<ReturnType<typeof register>>): Promise<string> {
  expect(registration.statusCode).toBe(201)
  const { accessToken } = registration.json() as { accessToken: string }
  const profile = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` } })
  return (profile.json() as { role: string }).role
}

/** Every `core.users` row, seen by the database owner (the table is not forced to row-level security). */
async function accountCount(): Promise<number> {
  return (await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.users`.execute(admin)).rows[0]?.n ?? 0
}

/** A deployment that has an app of its own, so a config override does not disturb the shared one. */
function appWith(overrides: Partial<Harness['config']>): App {
  return buildApp({ db: h.db, config: { ...h.config, ...overrides } })
}

describe('who may erase an instance', () => {
  it('refuses a request with no token', async () => {
    expect((await h.app.inject({ method: 'POST', url: URL, payload: { password: PASSWORD, confirmation: PHRASE } })).statusCode).toBe(401)
    expect((await h.app.inject({ method: 'GET', url: URL })).statusCode).toBe(401)
  })

  it('refuses a member with 403 owner_required, for the erase and for the preflight, and deletes nothing', async () => {
    const boss = await owner()
    const m = await member()
    const before = await accountCount()

    const res = await erase(m)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: 'owner_required' })
    const preflight = await check(m)
    expect(preflight.statusCode).toBe(403)

    expect(await accountCount()).toBe(before)
    expect((await me(boss)).statusCode).toBe(200)
    expect((await me(m)).statusCode).toBe(200)
  })

  it('refuses an owner who was demoted after signing in, because the role is read when the request is made', async () => {
    const demoted = await owner()
    await setRole(admin, demoted.id, 'member')
    expect((await erase(demoted)).statusCode).toBe(403)
    expect((await me(demoted)).statusCode).toBe(200)
  })
})

describe('what an owner must confirm', () => {
  it('refuses the wrong phrase on the confirmation field, and the phrase for "erase my data" is not accepted', async () => {
    const boss = await owner()
    const before = await accountCount()
    for (const confirmation of ['', 'erase', 'erase my data', 'erase this entire instance']) {
      const res = await erase(boss, { confirmation })
      expect(res.statusCode, confirmation).toBe(400)
      expect(res.json()).toMatchObject({ code: 'validation_failed', issues: [{ path: ['confirmation'] }] })
    }
    expect(await accountCount()).toBe(before)
  })

  it('refuses a wrong password with 403 on the password field, keeping the session', async () => {
    const boss = await owner()
    const before = await accountCount()
    const res = await erase(boss, { password: 'not-the-password' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: 'password_incorrect', issues: [{ path: ['password'] }] })
    expect(await accountCount()).toBe(before)
    expect((await me(boss)).statusCode).toBe(200)
  })

  it('needs a password at all', async () => {
    const boss = await owner()
    const res = await h.app.inject({ method: 'POST', url: URL, headers: auth(boss), payload: { confirmation: PHRASE } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ issues: [{ path: ['password'] }] })
  })

  it('limits attempts per user with 429 rate_limited', async () => {
    const app = appWith({ AUTH_EMAIL_RATE_LIMIT_MAX: 2 })
    try {
      const boss = await owner()
      const wrong = { password: 'not-the-password' }
      expect((await erase(boss, wrong, app)).statusCode).toBe(403)
      expect((await erase(boss, wrong, app)).statusCode).toBe(403)
      const limited = await erase(boss, {}, app)
      expect(limited.statusCode).toBe(429)
      expect(limited.json()).toMatchObject({ code: 'rate_limited' })
      expect((await me(boss)).statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/settings/erase-instance (what the screen shows before confirming)', () => {
  it('names the database, says whether registration is open, and counts other live sessions and people', async () => {
    const boss = await owner()
    const baseline = (await check(boss)).json() as { otherSessions: number; otherUsers: number }

    const m = await member()
    const second = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: m.email, password: PASSWORD },
    })
    expect(second.statusCode).toBe(200)

    const res = await check(boss)
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      databaseName: string; registrationEnabled: boolean; bootstrapOwnerEmail: string | null
      otherSessions: number; otherUsers: number; blocker: string | null
    }
    expect(body.databaseName).toBe('wickermoney_test')
    expect(body).toMatchObject({ registrationEnabled: true, bootstrapOwnerEmail: null, blocker: null })
    // Two sessions of one other person; the caller's own session is not counted.
    expect(body.otherSessions - baseline.otherSessions).toBe(2)
    expect(body.otherUsers - baseline.otherUsers).toBe(1)
  })

  it('changes nothing', async () => {
    const boss = await owner()
    const before = await accountCount()
    await check(boss)
    expect(await accountCount()).toBe(before)
  })

  it('reports the blocker when registration is off or another address is the designated owner', async () => {
    const boss = await owner()
    const closed = appWith({ REGISTRATION_ENABLED: false })
    const pinned = appWith({ BOOTSTRAP_OWNER_EMAIL: 'someone-else@example.com' })
    try {
      expect((await check(boss, closed)).json()).toMatchObject({ registrationEnabled: false, blocker: 'registration_disabled' })
      expect((await check(boss, pinned)).json()).toMatchObject({
        bootstrapOwnerEmail: 'someone-else@example.com', blocker: 'bootstrap_owner_mismatch',
      })
    } finally {
      await closed.close()
      await pinned.close()
    }
  })
})

describe('refusals that leave the instance as it was', () => {
  it('refuses while other sessions are live, until they are acknowledged, and says how many', async () => {
    const boss = await owner()
    await member()
    const before = await accountCount()

    const res = await erase(boss, { acknowledgeActiveSessions: false })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'active_sessions' })
    expect((res.json() as { message: string }).message).toMatch(/other session/)
    expect(await accountCount()).toBe(before)

    const omitted = await h.app.inject({
      method: 'POST', url: URL, headers: auth(boss), payload: { password: PASSWORD, confirmation: PHRASE },
    })
    expect(omitted.statusCode).toBe(409)
    expect(await accountCount()).toBe(before)
  })

  it('refuses while registration is off, because nobody could become the owner afterwards', async () => {
    const app = appWith({ REGISTRATION_ENABLED: false })
    try {
      const boss = await owner()
      const before = await accountCount()
      const res = await erase(boss, {}, app)
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ code: 'registration_disabled' })
      expect(await accountCount()).toBe(before)
    } finally {
      await app.close()
    }
  })

  it('refuses when BOOTSTRAP_OWNER_EMAIL names another address', async () => {
    const app = appWith({ BOOTSTRAP_OWNER_EMAIL: 'someone-else@example.com' })
    try {
      const boss = await owner()
      const before = await accountCount()
      const res = await erase(boss, {}, app)
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ code: 'bootstrap_owner_mismatch' })
      expect(await accountCount()).toBe(before)
    } finally {
      await app.close()
    }
  })
})

describe('erasing the instance', () => {
  it('removes every account and every row of every table, signs everyone out and clears the refresh cookie', async () => {
    const boss = await owner()
    const alice = await createUser(h)
    const bob = await createUser(h)
    await seedHousehold(h, boss, 'wipe-boss')
    await seedHousehold(h, alice, 'wipe-alice')
    await seedHousehold(h, bob, 'wipe-bob')
    for (const user of [boss, alice, bob]) {
      const before = await rowsOwnedBy(h.db, user.id)
      expect(Object.values(before).every((n) => n > 0), user.email).toBe(true)
    }

    const res = await erase(boss)
    expect(res.statusCode).toBe(204)
    const cleared = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
    expect(cleared?.value).toBe('')

    expect(await accountCount()).toBe(0)
    for (const user of [boss, alice, bob]) {
      expect(Object.values(await rowsOwnedBy(h.db, user.id)).every((n) => n === 0), user.email).toBe(true)
      expect((await me(user)).statusCode).toBe(401)
    }
    // A refresh cookie from before the erase does not bring anyone back.
    const refreshed = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-wickermoney-csrf': '1' },
      cookies: { [REFRESH_COOKIE_NAME]: boss.refreshToken },
    })
    expect(refreshed.statusCode).toBe(401)
    // Nor can the old password.
    const login = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: boss.email, password: PASSWORD } })
    expect(login.statusCode).toBe(401)
  })

  it('keeps the instance configuration: plugins stay registered and enabled as they were', async () => {
    const boss = await owner()
    const plugins = async () =>
      (await sql<{ plugin_id: string; enabled: boolean }>`SELECT plugin_id, enabled FROM core.plugins ORDER BY plugin_id`.execute(admin)).rows
    const before = await plugins()
    expect(before.length).toBeGreaterThan(0)

    expect((await erase(boss)).statusCode).toBe(204)
    expect(await plugins()).toEqual(before)
  })

  it('leaves an instance whose next registration becomes the owner, and the one after that a member', async () => {
    const boss = await owner()
    expect((await erase(boss)).statusCode).toBe(204)

    expect(await roleOf(await register('first-after-erase@example.com'))).toBe('owner')
    expect(await roleOf(await register('second-after-erase@example.com'))).toBe('member')
  })

  it('lets the designated address become the owner again when BOOTSTRAP_OWNER_EMAIL names the erasing owner', async () => {
    const boss = await owner()
    const app = appWith({ BOOTSTRAP_OWNER_EMAIL: boss.email })
    try {
      expect((await check(boss, app)).json()).toMatchObject({ blocker: null, bootstrapOwnerEmail: boss.email })
      expect((await erase(boss, {}, app)).statusCode).toBe(204)

      // Someone else registers first and is a member: only the designated address is promoted.
      expect(await roleOf(await register('not-designated@example.com', app))).toBe('member')
      expect(await roleOf(await register(boss.email, app))).toBe('owner')
    } finally {
      await app.close()
    }
  })

  it('is safe to run again: the second attempt is refused as unauthenticated and the empty instance stays usable', async () => {
    const boss = await owner()
    expect((await erase(boss)).statusCode).toBe(204)
    expect((await erase(boss)).statusCode).toBe(401)
    expect(await accountCount()).toBe(0)

    // A new owner can erase an instance that holds only their account, and again afterwards.
    const registration = await register('again-1@example.com')
    expect(await roleOf(registration)).toBe('owner')
    const next = { ...boss, accessToken: (registration.json() as { accessToken: string }).accessToken }
    const empty = await h.app.inject({
      method: 'POST', url: URL, headers: auth(next), payload: { password: PASSWORD, confirmation: PHRASE },
    })
    expect(empty.statusCode).toBe(204)
    expect(await accountCount()).toBe(0)
  })

  it('needs no acknowledgement when nobody else is signed in', async () => {
    const solo = await owner()
    // Make this the only account so that nobody else is signed in.
    await sql`UPDATE core.sessions SET revoked_at = now() WHERE user_id <> ${solo.id}::uuid`.execute(admin)

    const res = await h.app.inject({
      method: 'POST', url: URL, headers: auth(solo), payload: { password: PASSWORD, confirmation: PHRASE },
    })
    expect(res.statusCode).toBe(204)
    expect(await accountCount()).toBe(0)
  })
})
