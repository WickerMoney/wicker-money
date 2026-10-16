import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REFRESH_COOKIE_NAME } from '../auth/routes/helpers/REFRESH_COOKIE_NAME.js'
import { buildApp } from '../app.js'
import { createDb, type Db } from '../db/client.js'
import { pluginSchemaName } from '../db/plugin-roles.js'
import { seedHousehold } from '../testing/eraseFixtures.js'
import { exportAs } from '../testing/exportTicket.js'
import {
  TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser,
} from '../testing/harness.js'
import { rowsOwnedBy, setRole, userTables } from '../testing/userData.js'
import { CORE_ERASE_ORDER, PLUGIN_ERASE_PLANS, SESSIONS_TABLE, plannedTables } from './service/ERASE_PLAN.js'

/**
 * "Erase my data", end to end against real PostgreSQL: every table that holds
 * user data, each plugin schema, two users at once, and the failure modes.
 */

const PASSWORD = 'correct-horse-battery-staple'
const URL = '/api/v1/settings/erase-my-data'

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

function erase(user: TestUser, payload: Record<string, unknown> = { password: PASSWORD, confirmation: 'erase my data' }, app = h.app) {
  return app.inject({ method: 'POST', url: URL, headers: auth(user), payload })
}

/** A user who has been given something in every table. */
async function household(label: string): Promise<TestUser> {
  const user = await createUser(h)
  await seedHousehold(h, user, label)
  return user
}

const me = (accessToken: string) =>
  h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` } })

async function signIn(user: TestUser): Promise<TestUser> {
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: PASSWORD } })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { accessToken: string }
  const refresh = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
  return { ...user, accessToken: body.accessToken, refreshToken: refresh?.value ?? '' }
}

describe('what the seeded household covers', () => {
  it('has rows in every table that holds user data, so an erase has something to prove', async () => {
    const user = await household('coverage')
    const counts = await rowsOwnedBy(h.db, user.id)
    const empty = Object.entries(counts).filter(([, n]) => n === 0).map(([table]) => table)
    // If this fails, a table was added that the fixture cannot reach through the API.
    // Without a row in it, the erase tests below would pass for that table without proving anything.
    expect(empty).toEqual([])
    expect(Object.keys(counts)).toEqual(await userTables(h.db))
  })
})

describe('the erase plan covers the database', () => {
  it('names every table with a user_id column, in core and in every plugin schema', async () => {
    const planned = plannedTables()
    const unplanned = (await userTables(h.db)).filter((table) => !planned.has(table))
    // A new table with a user_id column fails here until it is added to ERASE_PLAN.ts.
    expect(unplanned).toEqual([])
  })

  it('names nothing the database no longer has', async () => {
    const present = new Set(await userTables(h.db))
    expect([...plannedTables()].filter((table) => !present.has(table))).toEqual([])
  })

  it('lists each table once, and sessions only as the final step', () => {
    const all = [
      ...CORE_ERASE_ORDER.map((t) => `core.${t}`),
      ...PLUGIN_ERASE_PLANS.flatMap((p) => p.tables.map((t) => `${pluginSchemaName(p.pluginId)}.${t}`)),
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(all).not.toContain(SESSIONS_TABLE)
  })
})

describe('POST /api/v1/settings/erase-my-data', () => {
  it('refuses the wrong phrase on the confirmation field, and erases nothing', async () => {
    const user = await household('phrase')
    const before = await rowsOwnedBy(h.db, user.id)

    for (const confirmation of ['', 'erase', 'erase this instance', 'delete my data']) {
      const res = await erase(user, { password: PASSWORD, confirmation })
      expect(res.statusCode, confirmation).toBe(400)
      expect(res.json()).toMatchObject({ code: 'validation_failed', issues: [{ path: ['confirmation'] }] })
    }
    const missing = await erase(user, { password: PASSWORD })
    expect(missing.statusCode).toBe(400)

    expect(await rowsOwnedBy(h.db, user.id)).toEqual(before)
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })

  it('refuses a wrong password with 403 on the password field, erases nothing and keeps the session', async () => {
    const user = await household('password')
    const before = await rowsOwnedBy(h.db, user.id)

    const res = await erase(user, { password: 'not-the-password', confirmation: 'erase my data' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: 'password_incorrect', issues: [{ path: ['password'] }] })

    expect(await rowsOwnedBy(h.db, user.id)).toEqual(before)
    // A 403, not a 401: the client does not read this as an expired session.
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })

  it('needs a password at all', async () => {
    const user = await createUser(h)
    const res = await erase(user, { confirmation: 'erase my data' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ issues: [{ path: ['password'] }] })
  })

  it('accepts the phrase in any case and with spaces around it', async () => {
    const user = await createUser(h)
    expect((await erase(user, { password: PASSWORD, confirmation: '  ERASE My Data ' })).statusCode).toBe(204)
  })

  it('removes every row of the caller from every table, signs them out everywhere, and keeps the account', async () => {
    const alice = await household('alice')
    const otherDevice = await signIn(alice)
    const profile = (await me(alice.accessToken)).json() as { id: string; email: string; role: string; timezone: string }
    expect((await rowsOwnedBy(h.db, alice.id))[SESSIONS_TABLE]).toBeGreaterThanOrEqual(2)

    const res = await erase(alice)
    expect(res.statusCode).toBe(204)
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)?.value).toBe('')

    // Every table: nothing left for her.
    const after = await rowsOwnedBy(h.db, alice.id)
    expect(Object.values(after).every((n) => n === 0), JSON.stringify(after)).toBe(true)

    // Signed out on every device at once, access and refresh tokens alike.
    for (const token of [alice.accessToken, otherDevice.accessToken]) expect((await me(token)).statusCode).toBe(401)
    for (const cookie of [alice.refreshToken, otherDevice.refreshToken]) {
      const refreshed = await h.app.inject({
        method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-wickermoney-csrf': '1' }, cookies: { [REFRESH_COOKIE_NAME]: cookie },
      })
      expect(refreshed.statusCode).toBe(401)
    }

    // The account stays: the same credentials work and the profile is unchanged.
    const again = await signIn(alice)
    expect((await me(again.accessToken)).json()).toEqual(profile)

    // And she is back at the start of setup, with an empty ledger.
    const onboarding = await h.app.inject({ method: 'GET', url: '/api/v1/onboarding', headers: auth(again) })
    expect(onboarding.json()).toMatchObject({ onboardedAt: null })
    const accounts = await h.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(again) })
    expect(accounts.json()).toEqual([])
    const exported = JSON.parse((await exportAs(h.app, again)).body) as {
      core: Record<string, unknown>; plugins: Record<string, Record<string, unknown>>
    }
    for (const [key, value] of Object.entries(exported.core)) {
      if (key !== 'profile') expect(value, key).toEqual([])
    }
    for (const data of Object.values(exported.plugins)) for (const [name, rows] of Object.entries(data)) expect(rows ?? [], name).toEqual([])
  })

  it('never touches another user: erasing Alice leaves Bob\'s rows, in every table, exactly as they were', async () => {
    const alice = await household('iso-a')
    const bob = await household('iso-b')
    const bobBefore = await rowsOwnedBy(h.db, bob.id)
    const bobExportBefore = (await exportAs(h.app, bob)).body
    const aliceBefore = await rowsOwnedBy(h.db, alice.id)

    expect((await erase(alice)).statusCode).toBe(204)

    expect(await rowsOwnedBy(h.db, bob.id)).toEqual(bobBefore)
    expect(Object.values(bobBefore).every((n) => n > 0)).toBe(true)
    expect(Object.values(aliceBefore).every((n) => n > 0)).toBe(true)
    // Bob is still signed in, and his export differs only by its timestamp.
    expect((await me(bob.accessToken)).statusCode).toBe(200)
    const bobExportAfter = (await exportAs(h.app, bob)).body
    const strip = (s: string) => s.replace(/"exportedAt":"[^"]*"/, '')
    expect(strip(bobExportAfter)).toBe(strip(bobExportBefore))

    // And the other way round: erasing Bob leaves a fresh Alice alone.
    const alice2 = await signIn(alice)
    await seedHousehold(h, alice2, 'iso-a2')
    const alice2Before = await rowsOwnedBy(h.db, alice.id)
    expect((await erase(bob)).statusCode).toBe(204)
    expect(await rowsOwnedBy(h.db, alice.id)).toEqual(alice2Before)
  })

  it('can be run again: nothing is left to delete, and it still succeeds', async () => {
    const user = await household('again')
    expect((await erase(user)).statusCode).toBe(204)
    // The first run ended the session; sign back in and run it on an already empty account.
    const again = await signIn(user)
    expect((await erase(again)).statusCode).toBe(204)
    const third = await signIn(user)
    expect(Object.values(await rowsOwnedBy(h.db, third.id)).every((n) => n <= 1)).toBe(true)
    expect((await me(third.accessToken)).statusCode).toBe(200)
  })

  it('does not remove the last owner: an owner who erases their data is still an owner', async () => {
    const owner = await household('owner')
    await setRole(admin, owner.id, 'owner')
    expect((await erase(owner)).statusCode).toBe(204)
    const again = await signIn(owner)
    expect(((await me(again.accessToken)).json() as { role: string }).role).toBe('owner')
    const roles = await sql<{ role: string }>`SELECT role::text AS role FROM core.users WHERE id = ${owner.id}::uuid`.execute(admin)
    expect(roles.rows[0]?.role).toBe('owner')
  })

  describe.each(PLUGIN_ERASE_PLANS.map((p) => [p.pluginId, p] as const))('plugin schema of %s', (_id, plan) => {
    const schema = pluginSchemaName(plan.pluginId)

    it('is emptied for the caller and left alone for everyone else', async () => {
      const alice = await household(`${schema}-a`)
      const bob = await household(`${schema}-b`)
      const mine = (counts: Record<string, number>) => plan.tables.map((t) => counts[`${schema}.${t}`])
      const aliceBefore = await rowsOwnedBy(h.db, alice.id)
      const bobBefore = await rowsOwnedBy(h.db, bob.id)
      expect(mine(aliceBefore).every((n) => (n ?? 0) > 0)).toBe(true)

      expect((await erase(alice)).statusCode).toBe(204)

      expect(mine(await rowsOwnedBy(h.db, alice.id))).toEqual(plan.tables.map(() => 0))
      expect(mine(await rowsOwnedBy(h.db, bob.id))).toEqual(mine(bobBefore))
    })

    it('is emptied even when the plugin is switched off, because switching it off keeps its data', async () => {
      const user = await household(`${schema}-off`)
      await sql`UPDATE core.plugins SET enabled = false WHERE plugin_id = ${plan.pluginId}`.execute(admin)
      try {
        expect((await erase(user)).statusCode).toBe(204)
      } finally {
        await sql`UPDATE core.plugins SET enabled = true WHERE plugin_id = ${plan.pluginId}`.execute(admin)
      }
      const counts = await rowsOwnedBy(h.db, user.id)
      expect(plan.tables.map((t) => counts[`${schema}.${t}`])).toEqual(plan.tables.map(() => 0))
    })
  })

  it('refuses, and erases nothing, while the database holds a user-data table the plan does not name', async () => {
    const user = await household('unplanned')
    const before = await rowsOwnedBy(h.db, user.id)
    await sql`CREATE TABLE plugin_budgets.zz_unplanned (user_id uuid NOT NULL)`.execute(admin)
    try {
      const res = await erase(user)
      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'erase_unplanned_tables' })
      expect(res.json<{ message: string }>().message).toContain('plugin_budgets.zz_unplanned')
    } finally {
      await sql`DROP TABLE plugin_budgets.zz_unplanned`.execute(admin)
    }
    expect(await rowsOwnedBy(h.db, user.id)).toEqual(before)
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })

  it('rolls everything back if a step fails part-way', async () => {
    const user = await household('rollback')
    const before = await rowsOwnedBy(h.db, user.id)
    // Make the last plugin table's delete fail from inside the transaction.
    await sql`CREATE FUNCTION plugin_budgets.zz_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`.execute(admin)
    await sql`CREATE TRIGGER zz_fail BEFORE DELETE ON plugin_budgets.budget_lines FOR EACH ROW EXECUTE FUNCTION plugin_budgets.zz_fail()`.execute(admin)
    try {
      expect((await erase(user)).statusCode).toBe(500)
    } finally {
      await sql`DROP TRIGGER zz_fail ON plugin_budgets.budget_lines`.execute(admin)
      await sql`DROP FUNCTION plugin_budgets.zz_fail()`.execute(admin)
    }
    expect(await rowsOwnedBy(h.db, user.id)).toEqual(before)
    expect((await me(user.accessToken)).statusCode).toBe(200)
  })

  it('limits attempts per user with 429 rate_limited, counting each user separately', async () => {
    const app = buildApp({ db: h.db, config: { ...h.config, AUTH_EMAIL_RATE_LIMIT_MAX: 2 } })
    try {
      const guesser = await createUser(h)
      const bystander = await createUser(h)
      const wrong = { password: 'not-the-password', confirmation: 'erase my data' }
      expect((await erase(guesser, wrong, app)).statusCode).toBe(403)
      expect((await erase(guesser, wrong, app)).statusCode).toBe(403)
      const limited = await erase(guesser, PASSWORD_PAYLOAD, app)
      expect(limited.statusCode).toBe(429)
      expect(limited.json()).toMatchObject({ code: 'rate_limited' })
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
      // The limit is the guesser's; someone else is unaffected.
      expect((await erase(bystander, wrong, app)).statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })
})

const PASSWORD_PAYLOAD = { password: PASSWORD, confirmation: 'erase my data' }
