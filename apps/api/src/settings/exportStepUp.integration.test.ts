import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'kysely'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../app.js'
import { REFRESH_COOKIE_NAME } from '../auth/routes/helpers/REFRESH_COOKIE_NAME.js'
import { createDb, type Db } from '../db/client.js'
import { asUser } from '../db/client.js'
import { BUNDLED_PLUGINS } from '../plugins/bundled.js'
import { exportHeaders, mintExportTicket, TEST_USER_PASSWORD } from '../testing/exportTicket.js'
import {
  TEST_ADMIN_DATABASE_URL, TEST_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser,
} from '../testing/harness.js'
import { EXPORT_TICKET_HEADER, EXPORT_TICKET_TTL_SECONDS } from './service/ExportTicketService.js'

/**
 * The password step-up for the data export, end to end against real PostgreSQL:
 * `POST /api/v1/settings/export-ticket` trades the password for a single-use
 * ticket, and `GET /api/v1/settings/export` accepts nothing without one.
 */

const EXPORT = '/api/v1/settings/export'
const TICKET = '/api/v1/settings/export-ticket'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('../plugins/registry.js')
  await seedBundledPlugins(h.db)
})
afterAll(async () => { await h.close() })
afterEach(() => { vi.useRealTimers() })

const getExport = (user: TestUser, ticket?: string, app = h.app) =>
  app.inject({
    method: 'GET', url: EXPORT,
    headers: ticket === undefined ? auth(user) : exportHeaders(user, ticket),
  })

const postTicketBody = (user: TestUser, payload: Record<string, unknown>, app = h.app) =>
  app.inject({ method: 'POST', url: TICKET, headers: auth(user), payload })

const postTicket = (user: TestUser, password: string = TEST_USER_PASSWORD, app = h.app) =>
  postTicketBody(user, { password }, app)

/** Signs the user in again: a second session with its own session family. */
async function signInAgain(user: TestUser): Promise<TestUser> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: TEST_USER_PASSWORD },
  })
  expect(res.statusCode).toBe(200)
  const refresh = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
  return { ...user, accessToken: (res.json() as { accessToken: string }).accessToken, refreshToken: refresh?.value ?? '' }
}

describe('POST /api/v1/settings/export-ticket', () => {
  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'POST', url: TICKET, payload: { password: TEST_USER_PASSWORD } })
    expect(res.statusCode).toBe(401)
  })

  it('exchanges the right password for a ticket that expires in two minutes and is not cached', async () => {
    const user = await createUser(h)
    const before = Date.now()
    const res = await postTicket(user)
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const body = res.json() as { ticket: string; expiresAt: string }
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'ticket'])
    expect(body.ticket.length).toBeGreaterThanOrEqual(43)
    const ttl = Date.parse(body.expiresAt) - before
    expect(ttl).toBeGreaterThan((EXPORT_TICKET_TTL_SECONDS - 5) * 1000)
    expect(ttl).toBeLessThanOrEqual((EXPORT_TICKET_TTL_SECONDS + 5) * 1000)
  })

  it('answers a wrong password 403 password_incorrect with the issue on the password field, not 401', async () => {
    const user = await createUser(h)
    const res = await postTicket(user, 'not-the-password')
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({
      code: 'password_incorrect', issues: [{ path: ['password'], message: 'Password is incorrect.' }],
    })
    expect(res.body).not.toContain('ticket')
    // The session is untouched: a 403 does not sign anyone out.
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(user) })).statusCode).toBe(200)
  })

  it('rejects a missing, empty or non-string password as a validation error on the field', async () => {
    const user = await createUser(h)
    for (const payload of [{}, { password: '' }, { password: 12345 }, { password: null }, { password: 'x'.repeat(1025) }]) {
      const res = await postTicketBody(user, payload)
      expect(res.statusCode, JSON.stringify(payload).slice(0, 40)).toBe(400)
      expect(res.json()).toMatchObject({ code: 'validation_failed' })
    }
  })

  it('does not accept the password of another user', async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    // Same password for every test user, so change Bob's to prove the check is per user.
    const changed = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: auth(bob),
      payload: { currentPassword: TEST_USER_PASSWORD, newPassword: 'a-different-long-passphrase-9' },
    })
    expect(changed.statusCode).toBeLessThan(300)
    const bobAgain = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: bob.email, password: 'a-different-long-passphrase-9' },
    })
    const bobSession = { ...bob, accessToken: (bobAgain.json() as { accessToken: string }).accessToken }
    expect((await postTicket(bobSession, TEST_USER_PASSWORD)).statusCode).toBe(403)
    expect((await postTicket(bobSession, 'a-different-long-passphrase-9')).statusCode).toBe(200)
    expect((await postTicket(alice, 'a-different-long-passphrase-9')).statusCode).toBe(403)
  })
})

describe('throttling wrong passwords', () => {
  const wrong = { password: 'not-the-password' }

  it('limits attempts per user with 429 rate_limited and a retry-after, counting each user separately', async () => {
    const app = buildApp({ db: h.db, config: { ...h.config, AUTH_EMAIL_RATE_LIMIT_MAX: 2 } })
    try {
      const guesser = await createUser(h)
      const bystander = await createUser(h)
      expect((await postTicket(guesser, wrong.password, app)).statusCode).toBe(403)
      expect((await postTicket(guesser, wrong.password, app)).statusCode).toBe(403)
      // Even the right password is refused once the allowance is spent: a stolen token cannot keep guessing.
      const limited = await postTicket(guesser, TEST_USER_PASSWORD, app)
      expect(limited.statusCode).toBe(429)
      expect(limited.json()).toMatchObject({ code: 'rate_limited' })
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
      expect((await postTicket(bystander, wrong.password, app)).statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('uses the danger zone\'s limiter: guesses at the export and at the erase share one allowance', async () => {
    const app = buildApp({ db: h.db, config: { ...h.config, AUTH_EMAIL_RATE_LIMIT_MAX: 3 } })
    try {
      const user = await createUser(h)
      const eraseWrong = () => app.inject({
        method: 'POST', url: '/api/v1/settings/erase-my-data', headers: auth(user),
        payload: { password: 'not-the-password', confirmation: 'erase my data' },
      })
      expect((await postTicket(user, wrong.password, app)).statusCode).toBe(403)
      expect((await eraseWrong()).statusCode).toBe(403)
      expect((await postTicket(user, wrong.password, app)).statusCode).toBe(403)
      expect((await eraseWrong()).statusCode).toBe(429)
      expect((await postTicket(user, TEST_USER_PASSWORD, app)).statusCode).toBe(429)
    } finally {
      await app.close()
    }
  })

  it('does not count a redeemed ticket as an attempt: downloads are not limited, only password checks', async () => {
    const app = buildApp({ db: h.db, config: { ...h.config, AUTH_EMAIL_RATE_LIMIT_MAX: 2 } })
    try {
      const user = await createUser(h)
      const first = await mintExportTicket(app, user)
      const second = await mintExportTicket(app, user)
      // The allowance for password checks is spent, and two downloads still go through.
      expect((await postTicket(user, TEST_USER_PASSWORD, app)).statusCode).toBe(429)
      expect((await getExport(user, first, app)).statusCode).toBe(200)
      expect((await getExport(user, second, app)).statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('answers 401 for a session that has ended, before any password is checked', async () => {
    const user = await createUser(h)
    const out = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/logout',
      headers: { ...auth(user), 'x-wickermoney-csrf': '1', cookie: `${REFRESH_COOKIE_NAME}=${user.refreshToken}` },
    })
    expect(out.statusCode).toBeLessThan(300)
    expect((await postTicket(user)).statusCode).toBe(401)
  })
})

describe('GET /api/v1/settings/export needs a ticket', () => {
  it('still answers 401 without a token, whatever else it carries', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    const bare = await h.app.inject({ method: 'GET', url: EXPORT, headers: { [EXPORT_TICKET_HEADER]: ticket } })
    expect(bare.statusCode).toBe(401)
    // A 401 does not spend the ticket.
    expect((await getExport(user, ticket)).statusCode).toBe(200)
  })

  it('refuses a request with a token and no ticket: 403 export_confirmation_required, no data, not 401', async () => {
    const user = await createUser(h)
    const res = await getExport(user)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      code: 'export_confirmation_required', message: 'Confirm your password to export your data.',
    })
    expect(res.body).not.toContain(user.email)
    expect(res.headers['content-disposition']).toBeUndefined()
  })

  it('refuses an empty, made-up or malformed ticket with 403 export_ticket_invalid', async () => {
    const user = await createUser(h)
    for (const ticket of ['', 'nope', 'x'.repeat(43), 'a'.repeat(5000)]) {
      const res = await getExport(user, ticket)
      expect(res.statusCode, ticket.slice(0, 10)).toBe(403)
      expect(res.json().code, ticket.slice(0, 10)).toBe(ticket === '' ? 'export_confirmation_required' : 'export_ticket_invalid')
    }
  })

  it('does not take the ticket from the query string, a cookie or the body', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    for (const request of [
      { url: `${EXPORT}?ticket=${ticket}`, headers: auth(user) },
      { url: EXPORT, headers: { ...auth(user), cookie: `ticket=${ticket}` } },
      { url: EXPORT, headers: auth(user), payload: { ticket } },
    ]) {
      const res = await h.app.inject({ method: 'GET', ...request })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('export_confirmation_required')
    }
    expect((await getExport(user, ticket)).statusCode).toBe(200)
  })

  it('serves the export for a valid ticket, as the same file download as before', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    const res = await getExport(user, ticket)
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['content-type'])).toContain('application/json')
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment; filename="wickermoney-export-\d{4}-\d{2}-\d{2}\.json"$/)
    const doc = JSON.parse(res.body) as { core: { profile: { id: string } } }
    expect(doc.core.profile.id).toBe(user.id)
  })

  it('works once: the same ticket is refused the second time', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    expect((await getExport(user, ticket)).statusCode).toBe(200)
    const again = await getExport(user, ticket)
    expect(again.statusCode).toBe(403)
    expect(again.json().code).toBe('export_ticket_invalid')
  })

  it('stops working after two minutes, with the access token still good', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    const fresh = await mintExportTicket(h.app, user)
    // Only the clock is faked, so the database and the HTTP stack behave normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + (EXPORT_TICKET_TTL_SECONDS - 5) * 1000)
    expect((await getExport(user, fresh)).statusCode).toBe(200)
    vi.setSystemTime(Date.now() + 6 * 1000)
    const late = await getExport(user, ticket)
    expect(late.statusCode).toBe(403)
    expect(late.json().code).toBe('export_ticket_invalid')
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(user) })).statusCode).toBe(200)
  })

  it('refuses another user\'s ticket, and the owner can still use it afterwards', async () => {
    const alice = await createUser(h)
    const bob = await createUser(h)
    const aliceTicket = await mintExportTicket(h.app, alice)

    const stolen = await getExport(bob, aliceTicket)
    expect(stolen.statusCode).toBe(403)
    expect(stolen.json().code).toBe('export_ticket_invalid')
    expect(stolen.body).not.toContain(alice.email)

    const mine = await getExport(alice, aliceTicket)
    expect(mine.statusCode).toBe(200)
    expect(JSON.parse(mine.body).core.profile.id).toBe(alice.id)
  })

  it('is bound to the session: the same user on another device cannot use it, and the original still can', async () => {
    const user = await createUser(h)
    const otherDevice = await signInAgain(user)
    const ticket = await mintExportTicket(h.app, user)

    const res = await getExport(otherDevice, ticket)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('export_ticket_invalid')
    expect((await getExport(user, ticket)).statusCode).toBe(200)
  })

  it('dies with the session: after logout the token is 401 and the ticket cannot be used by anyone', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    const out = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/logout',
      headers: { ...auth(user), 'x-wickermoney-csrf': '1', cookie: `${REFRESH_COOKIE_NAME}=${user.refreshToken}` },
    })
    expect(out.statusCode).toBeLessThan(300)
    expect((await getExport(user, ticket)).statusCode).toBe(401)
    // A new sign-in is a new session family, so the old ticket does not carry over to it.
    const again = await signInAgain(user)
    expect((await getExport(again, ticket)).statusCode).toBe(403)
  })

  it('is not bypassed by a plugin header on the host\'s own token', async () => {
    const user = await createUser(h)
    const res = await h.app.inject({
      method: 'GET', url: EXPORT, headers: { ...auth(user), 'x-wickermoney-plugin': 'wickermoney.budgets' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('export_confirmation_required')
  })

  it('has no POST twin that takes the password directly', async () => {
    const user = await createUser(h)
    const res = await h.app.inject({
      method: 'POST', url: EXPORT, headers: auth(user), payload: { password: TEST_USER_PASSWORD },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('plugin tokens stay out of the export and the ticket', () => {
  const BUDGETS = 'wickermoney.budgets'

  async function pluginToken(user: TestUser): Promise<string> {
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/plugins/${BUDGETS}/token`, headers: auth(user) })
    expect(res.statusCode).toBe(200)
    return (res.json() as { token: string }).token
  }

  it('refuses a plugin token on the export even with a valid ticket for the same user, and leaves the ticket unspent', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    const token = await pluginToken(user)

    for (const headers of [
      { authorization: `Bearer ${token}`, [EXPORT_TICKET_HEADER]: ticket },
      { authorization: `Bearer ${token}`, [EXPORT_TICKET_HEADER]: ticket, 'x-wickermoney-plugin': BUDGETS },
    ]) {
      const res = await h.app.inject({ method: 'GET', url: EXPORT, headers })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('plugin_route_denied')
      expect(res.body).not.toContain(user.email)
    }
    // Refused before the ticket was looked at: the host can still spend it.
    expect((await getExport(user, ticket)).statusCode).toBe(200)
  })

  it('refuses a plugin token on the ticket route, even with the right password, and issues nothing', async () => {
    const user = await createUser(h)
    const token = await pluginToken(user)
    const res = await h.app.inject({
      method: 'POST', url: TICKET, headers: { authorization: `Bearer ${token}`, 'x-wickermoney-plugin': BUDGETS },
      payload: { password: TEST_USER_PASSWORD },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('plugin_route_denied')
    expect(res.body).not.toContain('"ticket"')
  })

  it('does not let a plugin token wrongly guess the password either: the denial comes before the password check', async () => {
    const app = buildApp({ db: h.db, config: { ...h.config, AUTH_EMAIL_RATE_LIMIT_MAX: 1 } })
    try {
      const user = await createUser(h)
      const tokenRes = await app.inject({ method: 'POST', url: `/api/v1/plugins/${BUDGETS}/token`, headers: auth(user) })
      const token = (tokenRes.json() as { token: string }).token
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: 'POST', url: TICKET, headers: { authorization: `Bearer ${token}` }, payload: { password: 'guess' },
        })
        expect(res.json().code).toBe('plugin_route_denied')
      }
      // The user's own allowance was never touched by those guesses.
      expect((await postTicket(user, TEST_USER_PASSWORD, app)).statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})

describe('concurrent downloads', () => {
  it('lets exactly one of several simultaneous requests with the same ticket through', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(h.app, user)
    const results = await Promise.all(Array.from({ length: 6 }, () => getExport(user, ticket)))
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1)
    const refused = results.filter((r) => r.statusCode !== 200)
    expect(refused).toHaveLength(5)
    expect(refused.every((r) => r.statusCode === 403 && r.json().code === 'export_ticket_invalid')).toBe(true)
  })

  it('lets simultaneous requests with their own tickets all through, each a complete document', async () => {
    const user = await createUser(h)
    const other = await createUser(h)
    const tickets = await Promise.all([
      mintExportTicket(h.app, user), mintExportTicket(h.app, user), mintExportTicket(h.app, user),
      mintExportTicket(h.app, other),
    ])
    const results = await Promise.all([
      getExport(user, tickets[0] as string), getExport(user, tickets[1] as string),
      getExport(user, tickets[2] as string), getExport(other, tickets[3] as string),
    ])
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200])
    const ids = results.map((r) => (JSON.parse(r.body) as { core: { profile: { id: string } } }).core.profile.id)
    expect(ids).toEqual([user.id, user.id, user.id, other.id])
  })

  it('holds a person to five live tickets: a sixth drops the oldest, which then fails cleanly', async () => {
    const user = await createUser(h)
    const tickets: string[] = []
    for (let i = 0; i < 6; i++) tickets.push(await mintExportTicket(h.app, user))
    expect((await getExport(user, tickets[0] as string)).statusCode).toBe(403)
    expect((await getExport(user, tickets[5] as string)).statusCode).toBe(200)
  })
})

describe('a large export still streams, under the long statement timeout', () => {
  let admin: Db
  let shortDb: Db
  let app: ReturnType<typeof buildApp>
  let base: string

  beforeAll(async () => {
    admin = createDb(TEST_ADMIN_DATABASE_URL)
    // Statements are cut off after one second on this pool; the export is allowed sixty.
    shortDb = createDb(TEST_DATABASE_URL, { statementTimeoutMillis: 1_000 })
    app = buildApp({
      db: shortDb,
      config: { ...h.config, DB_STATEMENT_TIMEOUT: 1_000, DB_LONG_STATEMENT_TIMEOUT: 60_000 },
      pluginOptions: { bundled: BUNDLED_PLUGINS },
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    await app.close()
    await shortDb.destroy()
    await admin.destroy()
  })

  /** Asks the real HTTP server for the export and reads the body as it arrives. */
  async function download(user: TestUser, ticket: string) {
    const res = await fetch(`${base}${EXPORT}`, { headers: exportHeaders(user, ticket) })
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    return { res, chunks, text: Buffer.concat(chunks).toString('utf8') }
  }

  it('sends a ledger of tens of thousands of rows as a chunked stream that parses and is complete', async () => {
    const user = await createUser(h)
    const account = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(user), payload: { name: 'Big', accountType: 'checking' },
    })
    const accountId = (account.json() as { id: string }).id
    await asUser(h.db, user.id, (trx) => sql`
      INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date)
      SELECT ${user.id}::uuid, ${accountId}::uuid, -1.00, 'bulk ' || n, DATE '2026-01-01' + (n % 28)
      FROM generate_series(1, 30000) AS n
    `.execute(trx))

    const ticket = await mintExportTicket(app, user)
    const { res, chunks, text } = await download(user, ticket)

    expect(res.status).toBe(200)
    expect(res.headers.get('transfer-encoding')).toBe('chunked')
    expect(res.headers.get('content-length')).toBeNull()
    // Delivered in pieces as it was read, not assembled first.
    expect(chunks.length).toBeGreaterThan(10)
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(1_000_000)
    const doc = JSON.parse(text) as { core: { transactions: Array<{ id: string }> } }
    expect(new Set(doc.core.transactions.map((t) => t.id)).size).toBe(30000)
    // And the ticket was spent doing it.
    expect((await app.inject({ method: 'GET', url: EXPORT, headers: exportHeaders(user, ticket) })).statusCode).toBe(403)
  }, 120_000)

  it('waits out a statement longer than the ordinary limit, which an ordinary request does not', async () => {
    const user = await createUser(h)
    const ticket = await mintExportTicket(app, user)

    // Another session holds the accounts table for 2.5 s: longer than the one-second
    // statement limit, shorter than the export's sixty.
    const locker = admin.transaction().execute(async (trx) => {
      await sql`LOCK TABLE core.accounts IN ACCESS EXCLUSIVE MODE`.execute(trx)
      await new Promise((resolve) => setTimeout(resolve, 2_500))
    })
    await new Promise((resolve) => setTimeout(resolve, 300))

    const ordinary = await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(user) })
    const exporting = download(user, ticket)
    await locker

    // The control: the same wait ends an ordinary request.
    expect(ordinary.statusCode).toBeGreaterThanOrEqual(500)
    const { res, text } = await exporting
    expect(res.status).toBe(200)
    expect((JSON.parse(text) as { core: { profile: { id: string } } }).core.profile.id).toBe(user.id)
  }, 60_000)
})
