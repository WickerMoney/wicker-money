import { SignJWT, decodeJwt } from 'jose'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { PLUGIN_ROUTE_ACCESS } from '../auth/pluginRouteAccess.js'
import { PLUGIN_TOKEN_MAX_TTL_SECONDS, pluginTokenAudience, signPluginToken } from '../auth/pluginTokens.js'
import { KyselyUnitOfWork } from '../data/KyselyUnitOfWork.js'
import { createDb, type Db } from '../db/client.js'
import { HOSTILE_PLUGIN_ID, hostileManifest } from '../testing/hostilePlugin.js'
import { seedHousehold } from '../testing/eraseFixtures.js'
import {
  TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser,
} from '../testing/harness.js'
import { rowsOwnedBy } from '../testing/userData.js'
import { BUNDLED_PLUGINS } from './bundled.js'
import { PluginService } from './service/PluginService.js'

/**
 * ADR 0005, stage 4: the server half of the hostile-plugin suite.
 *
 * A hostile plugin never holds the host's access token (the browser suite in
 * `apps/web/browser-check/hostile/` proves the frame cannot get one). What it
 * can hold, through the broker, is its own short-lived plugin token. This file
 * is the worst case for the server: the token is in hostile hands, the user is
 * an instance owner (so a role check would not save anything), and the
 * requests are the ones ADR 0005's threat model names. Every attempt must be
 * refused with a stated reason and must leave the data as it was.
 *
 * "Stated reason" is one of: `401` (the credential is not good), `403
 * plugin_route_denied` (the route is not one plugin tokens may reach),
 * `403 plugin_disabled`, or `403 grant_denied` (the grant does not cover the
 * table). A `404` or a `200` never counts.
 */

const PASSWORD = 'correct-horse-battery-staple'
const INSIGHTS = 'wickermoney.insights'
const BUDGETS = 'wickermoney.budgets'
const SOME_UUID = '3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c'

let h: Harness
let admin: Db
let app: ReturnType<typeof buildApp>
let registry: PluginService

let owner: TestUser
let otherOwner: TestUser
let stranger: TestUser
let hostileToken: string
let previousOwners: string[] = []

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

async function mintFor(user: TestUser, pluginId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: `/api/v1/plugins/${pluginId}/token`, headers: auth(user) })
  if (res.statusCode !== 200) throw new Error(`mint failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { token: string }).token
}

const setEnabled = (pluginId: string, enabled: boolean) =>
  app.inject({ method: 'PATCH', url: `/api/v1/plugins/${pluginId}`, headers: auth(owner), payload: { enabled } })

beforeAll(async () => {
  const bundled = [...BUNDLED_PLUGINS, hostileManifest()]
  h = await createHarness()
  app = buildApp({ db: h.db, config: h.config, pluginOptions: { bundled } })
  await app.ready()
  registry = new PluginService(new KyselyUnitOfWork(h.db), { bundled })
  await registry.seedBundled()
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)

  admin = createDb(TEST_ADMIN_DATABASE_URL)
  owner = await createUser(h)
  otherOwner = await createUser(h)
  stranger = await createUser(h)
  // Exactly two owners for the run, so owner-only routes would succeed for the
  // user whose token is stolen, and demoting `otherOwner` would not hit the
  // last-owner rule. The previous owners come back in afterAll.
  const { rows } = await sql<{ id: string }>`UPDATE core.users SET role = 'member' WHERE role = 'owner' RETURNING id`.execute(admin)
  previousOwners = rows.map((r) => r.id)
  await sql`UPDATE core.users SET role = 'owner' WHERE id = ANY(${[owner.id, otherOwner.id]}::uuid[])`.execute(admin)
  await seedHousehold(h, owner, 'hostile')
  await seedHousehold(h, stranger, 'stranger')
  hostileToken = await mintFor(owner, HOSTILE_PLUGIN_ID)
})

afterAll(async () => {
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)
  await sql`DELETE FROM core.plugins WHERE plugin_id = ${HOSTILE_PLUGIN_ID}`.execute(admin)
  await sql`UPDATE core.users SET role = 'member' WHERE role = 'owner'`.execute(admin)
  if (previousOwners.length > 0) await sql`UPDATE core.users SET role = 'owner' WHERE id = ANY(${previousOwners}::uuid[])`.execute(admin)
  await admin.destroy()
  await app.close()
  await h.close()
})

// ---------------------------------------------------------------------------
// The denied route classes, listed explicitly.
//
// This is a second, independent statement of what `PLUGIN_ROUTE_ACCESS` says.
// It is deliberately long and deliberately written out: loosening a route to
// plugins has to be a visible edit in two files, and a route moved out of the
// denied set has to be argued for here.
// ---------------------------------------------------------------------------

const DENIED_CLASSES: Readonly<Record<string, readonly string[]>> = {
  'authentication (a plugin never signs in, refreshes, registers or changes credentials)': [
    'POST /api/v1/auth/register',
    'POST /api/v1/auth/login',
    'POST /api/v1/auth/refresh',
    'POST /api/v1/auth/logout',
    'POST /api/v1/auth/change-password',
    'GET /api/v1/auth/me',
    'PATCH /api/v1/auth/me',
  ],
  'instance settings, the full data export and the erase actions': [
    'GET /api/v1/settings/config',
    'GET /api/v1/settings/export',
    'POST /api/v1/settings/erase-my-data',
    'GET /api/v1/settings/erase-instance',
    'POST /api/v1/settings/erase-instance',
  ],
  'plugin management and token minting (setPluginEnabled, listRegisteredPlugins, mint)': [
    'GET /api/v1/plugins',
    'GET /api/v1/plugins/registry',
    'PATCH /api/v1/plugins/:pluginId',
    'POST /api/v1/plugins/:pluginId/token',
  ],
  'owner role management': [
    'GET /api/v1/users',
    'PATCH /api/v1/users/:id/role',
  ],
  'host data screens: accounts': [
    'GET /api/v1/accounts',
    'POST /api/v1/accounts',
    'GET /api/v1/accounts/:id',
    'PATCH /api/v1/accounts/:id',
    'DELETE /api/v1/accounts/:id',
    'POST /api/v1/accounts/:id/archive',
    'GET /api/v1/accounts/:id/usage',
    'POST /api/v1/accounts/:id/delete-with-history',
    'POST /api/v1/accounts/:id/migrate',
    'POST /api/v1/accounts/:id/migrate/preview',
    'POST /api/v1/accounts/:id/initial-balance',
    'POST /api/v1/accounts/:id/initial-balance/preview',
  ],
  'host data screens: categories and rules': [
    'GET /api/v1/categories',
    'POST /api/v1/categories',
    'GET /api/v1/categories/catalog',
    'POST /api/v1/categories/starter',
    'PATCH /api/v1/categories/:id',
    'DELETE /api/v1/categories/:id',
    'GET /api/v1/categories/:id/usage',
    'GET /api/v1/category-rules',
    'POST /api/v1/category-rules',
    'POST /api/v1/category-rules/preview',
    'DELETE /api/v1/category-rules/:id',
  ],
  'host data screens: onboarding': [
    'GET /api/v1/onboarding',
    'POST /api/v1/onboarding/preview',
    'POST /api/v1/onboarding/complete',
    'POST /api/v1/onboarding/reset',
  ],
  'host data screens: transactions': [
    'GET /api/v1/transactions',
    'POST /api/v1/transactions',
    'POST /api/v1/transactions/categorize',
    'POST /api/v1/transactions/transfer',
    'PATCH /api/v1/transactions/:id',
    'DELETE /api/v1/transactions/:id',
    'PUT /api/v1/transactions/:id/splits',
    'GET /api/v1/transactions/:id/splits',
    'DELETE /api/v1/transactions/:id/splits',
  ],
  'host data screens: recurring items': [
    'GET /api/v1/recurring-items',
    'POST /api/v1/recurring-items',
    'GET /api/v1/recurring-items/occurrences',
    'GET /api/v1/recurring-items/suggestions',
    'GET /api/v1/recurring-items/transaction-matches',
    'GET /api/v1/recurring-items/transaction-matches/:transactionId',
    'GET /api/v1/recurring-items/:id',
    'PUT /api/v1/recurring-items/:id',
    'DELETE /api/v1/recurring-items/:id',
    'POST /api/v1/recurring-items/:id/end',
    'GET /api/v1/recurring-items/:id/occurrences/:date',
    'PUT /api/v1/recurring-items/:id/occurrences/:date',
    'GET /api/v1/recurring-items/:id/occurrences/:date/candidates',
    'POST /api/v1/recurring-items/:id/occurrences/:date/matches',
    'DELETE /api/v1/recurring-items/:id/occurrences/:date/matches/:transactionId',
    'POST /api/v1/recurring-items/:id/occurrences/:date/dismissals',
    'DELETE /api/v1/recurring-items/:id/occurrences/:date/dismissals/:transactionId',
  ],
}

const ALL_DENIED = Object.values(DENIED_CLASSES).flat()

/** Fills a route pattern's parameters with plausible values. */
function concrete(pattern: string, overrides: Record<string, string> = {}): string {
  return pattern.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    if (overrides[name] !== undefined) return overrides[name]
    if (name === 'date') return '2026-01-01'
    if (name === 'pluginId') return HOSTILE_PLUGIN_ID
    return SOME_UUID
  })
}

/**
 * The strongest body each route could be given, so that without the token rule
 * the handler would have done what the attacker wanted: the password and phrase
 * are right, the role change is a real one, the plugin switch is a real switch.
 */
function attackBody(route: string): Record<string, unknown> | undefined {
  switch (route) {
    case 'POST /api/v1/settings/erase-my-data':
      return { password: PASSWORD, confirmation: 'erase my data' }
    case 'POST /api/v1/settings/erase-instance':
      return { password: PASSWORD, confirmation: 'erase this instance', acknowledgeActiveSessions: true }
    case 'PATCH /api/v1/plugins/:pluginId':
      return { enabled: false }
    case 'PATCH /api/v1/users/:id/role':
      return { role: 'member' }
    case 'POST /api/v1/auth/change-password':
      return { currentPassword: PASSWORD, newPassword: 'a-different-long-passphrase-9' }
    case 'POST /api/v1/auth/register':
    case 'POST /api/v1/auth/login':
      return { email: 'attacker-created@example.com', password: PASSWORD }
    case 'PATCH /api/v1/auth/me':
      return { timezone: 'Pacific/Kiritimati' }
    default:
      return route.startsWith('GET ') || route.startsWith('DELETE ') ? undefined : {}
  }
}

describe('the denied route classes match the classification table', () => {
  it('lists exactly the routes PLUGIN_ROUTE_ACCESS marks denied, no more and no fewer', () => {
    const denied = Object.entries(PLUGIN_ROUTE_ACCESS).filter(([, a]) => a.kind === 'denied').map(([k]) => k).sort()
    // A route added to (or dropped from) the table without this list fails here, in both directions.
    expect([...ALL_DENIED].sort()).toEqual(denied)
  })

  it('names every route once, and every entry that is not denied is a core aggregate read behind a table grant', () => {
    expect(new Set(ALL_DENIED).size).toBe(ALL_DENIED.length)
    const allowed = Object.entries(PLUGIN_ROUTE_ACCESS).filter(([, a]) => a.kind !== 'denied')
    expect(allowed.every(([k, a]) => k.startsWith('GET /api/v1/core/') && a.kind === 'core')).toBe(true)
    expect(allowed).toHaveLength(8)
  })
})

describe('controls: the same requests are not refused for the host', () => {
  // If these failed, the denials below could be about the user or the role, not the token.
  it.each([
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/plugins/registry'],
    ['GET', '/api/v1/settings/export'],
    ['GET', '/api/v1/settings/erase-instance'],
    ['GET', '/api/v1/auth/me'],
    ['GET', '/api/v1/accounts'],
  ])('%s %s works with the owner\'s own access token', async (method, url) => {
    const res = await app.inject({ method: method as 'GET', url, headers: auth(owner) })
    expect(res.statusCode).toBe(200)
  })
})

describe('a plugin token is refused on every denied route class', () => {
  let before: Record<string, number>
  let usersBefore: number
  let enabledBefore: string

  beforeAll(async () => {
    before = await rowsOwnedBy(h.db, owner.id)
    usersBefore = Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM core.users`.execute(admin)).rows[0]?.n)
    enabledBefore = JSON.stringify((await sql`SELECT plugin_id, enabled FROM core.plugins ORDER BY plugin_id`.execute(admin)).rows)
  })

  for (const [klass, routes] of Object.entries(DENIED_CLASSES)) {
    describe(klass, () => {
      it.each(routes)('%s -> 403 plugin_route_denied', async (route) => {
        const [method, pattern] = route.split(' ') as [string, string]
        const url = concrete(pattern, pattern === '/api/v1/users/:id/role' ? { id: otherOwner.id } : {})
        const body = attackBody(route)
        const res = await app.inject({
          method: method as 'GET',
          url,
          headers: {
            ...bearer(hostileToken),
            // Everything a same-origin script could add to look like the host: the CSRF header and
            // the refresh cookie. None of it may matter to a request that carries a plugin token.
            'x-wickermoney-csrf': '1',
            cookie: `wickermoney_refresh=${owner.refreshToken}`,
          },
          ...(body === undefined ? {} : { payload: body }),
        })
        expect(res.statusCode, `${route} -> ${res.body.slice(0, 200)}`).toBe(403)
        expect(res.json().code).toBe('plugin_route_denied')
        expect(res.body).not.toContain(owner.email)
      })
    })
  }

  it('leaves everything as it was after all of them: data, owners, plugins, accounts, the session and the password', async () => {
    expect(await rowsOwnedBy(h.db, owner.id)).toEqual(before)
    expect(Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM core.users`.execute(admin)).rows[0]?.n)).toBe(usersBefore)
    expect(JSON.stringify((await sql`SELECT plugin_id, enabled FROM core.plugins ORDER BY plugin_id`.execute(admin)).rows)).toBe(enabledBefore)
    const roles = await sql<{ id: string; role: string }>`SELECT id, role::text FROM core.users WHERE id = ANY(${[owner.id, otherOwner.id]}::uuid[])`.execute(admin)
    expect(roles.rows.every((r) => r.role === 'owner')).toBe(true)
    // The host session still works, and so does the password (no change-password went through).
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(owner) })).statusCode).toBe(200)
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: owner.email, password: PASSWORD } })
    expect(login.statusCode).toBe(200)
  })
})

describe('the refresh route, the one that needs no bearer', () => {
  it('is refused when a plugin token rides along with a valid refresh cookie and CSRF header', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      headers: { ...bearer(hostileToken), 'x-wickermoney-csrf': '1', cookie: `wickermoney_refresh=${owner.refreshToken}` },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('plugin_route_denied')
    expect(res.body).not.toContain('accessToken')
  })

  it('gives nothing without the cookie, which a sandboxed frame never has (credentials are omitted)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', headers: { 'x-wickermoney-csrf': '1' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.body).not.toContain('accessToken')
  })
})

describe('the header is not an identity', () => {
  const summary = '/api/v1/core/accounts/summary'

  it('a plugin token with the plugin header omitted is still a plugin: denied on the export', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/settings/export', headers: bearer(hostileToken) })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('plugin_route_denied')
  })

  it('a forged header naming a plugin with more grants does not widen the token', async () => {
    // import-csv holds accounts:read. The hostile fixture does not.
    const res = await app.inject({
      method: 'GET', url: summary, headers: { ...bearer(hostileToken), 'x-wickermoney-plugin': 'wickermoney.import-csv' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('grant_denied')
  })

  it('a forged header naming another plugin cannot open that plugin\'s namespace either', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/p/${BUDGETS}/month`, headers: { ...bearer(hostileToken), 'x-wickermoney-plugin': BUDGETS },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('plugin_route_denied')
  })

  it('a malformed or repeated header is ignored the same way', async () => {
    for (const value of ['', ' ', '*', '../../auth', `${HOSTILE_PLUGIN_ID}, ${BUDGETS}`]) {
      const res = await app.inject({ method: 'GET', url: summary, headers: { ...bearer(hostileToken), 'x-wickermoney-plugin': value } })
      expect(res.statusCode, `header ${JSON.stringify(value)}`).toBe(403)
    }
  })

  it('the header never turns a plugin request into a host request: a granted table still works only as the token says', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1', headers: { ...bearer(hostileToken), 'x-wickermoney-plugin': 'nobody.at.all' },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('tables the plugin was not granted', () => {
  it('a core read outside the grant is 403 grant_denied, naming the table', async () => {
    for (const url of [
      '/api/v1/core/accounts/summary', '/api/v1/core/accounts/list', '/api/v1/core/categories/list',
      '/api/v1/core/recurring-items/list', '/api/v1/core/recurring-items/occurrences',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: bearer(hostileToken) })
      expect(res.statusCode, url).toBe(403)
      expect(res.json().code).toBe('grant_denied')
    }
  })

  it('a route that needs two tables is refused when the plugin holds only one of them', async () => {
    for (const url of ['/api/v1/core/recurring-items/upcoming', '/api/v1/core/recurring-items/forecast']) {
      const res = await app.inject({ method: 'GET', url, headers: bearer(hostileToken) })
      expect(res.statusCode, url).toBe(403)
    }
  })

  it('a token signed with wider grants than the manifest has today is narrowed to the manifest', async () => {
    const { token } = await signPluginToken(h.config, {
      sub: owner.id, email: owner.email, sid: decodeJwt(owner.accessToken)['sid'] as string,
      plg: HOSTILE_PLUGIN_ID, tbl: { transactions: 'write', accounts: 'write', categories: 'write' },
    })
    expect((await app.inject({ method: 'GET', url: '/api/v1/core/accounts/summary', headers: bearer(token) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1', headers: bearer(token) })).statusCode).toBe(200)
  })
})

describe('another plugin\'s /p/* routes', () => {
  it('a token for one plugin is refused in another plugin\'s namespace, whichever plugin it is', async () => {
    const insights = await mintFor(owner, INSIGHTS)
    for (const token of [hostileToken, insights]) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/p/${BUDGETS}/month`, headers: bearer(token) })
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('plugin_route_denied')
    }
  })

  it('control: the budgets token reaches the budgets namespace, and the host token does too', async () => {
    const budgets = await mintFor(owner, BUDGETS)
    expect((await app.inject({ method: 'GET', url: `/api/v1/p/${BUDGETS}/at-risk`, headers: bearer(budgets) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/v1/p/${BUDGETS}/at-risk`, headers: auth(owner) })).statusCode).toBe(200)
  })

  it('the hostile fixture owns a namespace of its own and has no routes in it (no third-party server code)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/p/${HOSTILE_PLUGIN_ID}/anything`, headers: bearer(hostileToken) })
    expect(res.statusCode).toBe(404)
  })

  it('a plugin id cannot be smuggled through a parameter or a prefix', async () => {
    for (const url of [`/api/v1/p/${HOSTILE_PLUGIN_ID}/../${BUDGETS}/month`, `/api/v1/p/${BUDGETS}%2f..%2fmonth`, `/api/v1/p//${BUDGETS}/month`]) {
      const res = await app.inject({ method: 'GET', url, headers: bearer(hostileToken) })
      expect([403, 404], url).toContain(res.statusCode)
      expect(res.statusCode === 200).toBe(false)
    }
  })
})

describe('a token that is not good', () => {
  const claimsFor = (user: TestUser) => ({
    sub: user.id, email: user.email, sid: decodeJwt(user.accessToken)['sid'] as string, plg: HOSTILE_PLUGIN_ID, tbl: { transactions: 'read' as const },
  })
  const read = (token: string) => app.inject({ method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1', headers: bearer(token) })
  const exportWith = (token: string) => app.inject({ method: 'GET', url: '/api/v1/settings/export', headers: bearer(token) })

  it('an expired token is 401 on a route it could reach and on one it could not', async () => {
    const { token } = await signPluginToken(h.config, claimsFor(owner), { now: new Date(Date.now() - 10 * 60_000), ttlSeconds: 60 })
    expect((await read(token)).statusCode).toBe(401)
    expect((await exportWith(token)).statusCode).toBe(401)
  })

  it('a token older than the maximum age is 401 even though it carries a later expiry', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - PLUGIN_TOKEN_MAX_TTL_SECONDS - 60
    const token = await new SignJWT({ email: owner.email, sid: claimsFor(owner).sid, plg: HOSTILE_PLUGIN_ID, tbl: { transactions: 'read' } })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(owner.id).setIssuer(h.config.AUTH_ISSUER)
      .setAudience(pluginTokenAudience(h.config)).setIssuedAt(issuedAt).setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode(h.config.AUTH_SECRET))
    expect((await read(token)).statusCode).toBe(401)
  })

  it('a token for another plugin\'s grants cannot be re-labelled: changing a claim breaks the signature', async () => {
    const [head, payload, signature] = hostileToken.split('.') as [string, string, string]
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    for (const tampered of [{ ...claims, plg: BUDGETS }, { ...claims, tbl: { accounts: 'write', transactions: 'write' } }, { ...claims, sub: stranger.id }]) {
      const forged = `${head}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`
      expect((await read(forged)).statusCode).toBe(401)
      expect((await exportWith(forged)).statusCode).toBe(401)
    }
  })

  it('"alg": "none", a foreign signing key and a truncated token are all 401', async () => {
    const claims = { ...claimsFor(owner), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, iss: h.config.AUTH_ISSUER, aud: pluginTokenAudience(h.config) }
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`
    const foreign = await new SignJWT(claimsFor(owner)).setProtectedHeader({ alg: 'HS256' }).setSubject(owner.id).setIssuer(h.config.AUTH_ISSUER)
      .setAudience(pluginTokenAudience(h.config)).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('some-other-secret-that-is-long-enough-xx'))
    for (const token of [unsigned, foreign, hostileToken.slice(0, -6), '', 'x.y.z']) {
      expect((await read(token)).statusCode, token.slice(0, 20)).toBe(401)
    }
  })

  it('an access token is not a plugin token, and a plugin token is not an access token', async () => {
    // The host token is accepted as the host (200); the plugin token is not accepted by anything that wants the host.
    expect((await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(owner) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/accounts', headers: bearer(hostileToken) })).statusCode).toBe(403)
  })

  it('a different scheme, a doubled header or a bare token is not read as a plugin token or a host token', async () => {
    for (const authorization of [`bearer ${hostileToken}`, hostileToken, `Basic ${hostileToken}`, `Bearer  ${hostileToken}`, `Bearer ${hostileToken}, Bearer ${hostileToken}`]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/settings/export', headers: { authorization } })
      expect(res.statusCode, authorization.slice(0, 24)).toBe(401)
    }
  })

  it('a token minted under a session that was then ended is 401 (logout)', async () => {
    const victim = await createUser(h)
    const token = await mintFor(victim, HOSTILE_PLUGIN_ID)
    expect((await read(token)).statusCode).toBe(200)
    const out = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout',
      headers: { ...auth(victim), 'x-wickermoney-csrf': '1', cookie: `wickermoney_refresh=${victim.refreshToken}` },
    })
    expect(out.statusCode).toBeLessThan(300)
    expect((await read(token)).statusCode).toBe(401)
  })

  it('a token minted under a session that was then ended is 401 (password change)', async () => {
    const victim = await createUser(h)
    const token = await mintFor(victim, HOSTILE_PLUGIN_ID)
    const changed = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: auth(victim),
      payload: { currentPassword: PASSWORD, newPassword: 'a-different-long-passphrase-9' },
    })
    expect(changed.statusCode).toBeLessThan(300)
    expect((await read(token)).statusCode).toBe(401)
  })
})

describe('two users', () => {
  it('a plugin token reads only its own user\'s rows; the other user\'s household never shows', async () => {
    const mine = await app.inject({ method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=12', headers: bearer(hostileToken) })
    expect(mine.statusCode).toBe(200)
    const strangersToken = await mintFor(stranger, HOSTILE_PLUGIN_ID)
    const theirs = await app.inject({ method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=12', headers: bearer(strangersToken) })
    expect(theirs.statusCode).toBe(200)
    expect(mine.body).not.toContain(stranger.id)
    expect(theirs.body).not.toContain(owner.id)
  })
})

describe('a plugin that is switched off', () => {
  it('stops working on its next request, whatever token it still holds, and works again when switched back on', async () => {
    const token = await mintFor(owner, HOSTILE_PLUGIN_ID)
    const read = () => app.inject({ method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1', headers: bearer(token) })
    expect((await read()).statusCode).toBe(200)
    expect((await setEnabled(HOSTILE_PLUGIN_ID, false)).statusCode).toBe(200)
    try {
      const off = await read()
      expect(off.statusCode).toBe(403)
      expect(off.json().code).toBe('plugin_disabled')
      // And no new token can be minted for it.
      const mint = await app.inject({ method: 'POST', url: `/api/v1/plugins/${HOSTILE_PLUGIN_ID}/token`, headers: auth(owner) })
      expect(mint.statusCode).toBe(404)
      expect(mint.json().code).toBe('plugin_disabled')
    } finally {
      expect((await setEnabled(HOSTILE_PLUGIN_ID, true)).statusCode).toBe(200)
    }
    expect((await read()).statusCode).toBe(200)
  })
})

describe('path tricks against the route classification', () => {
  // Classification is by the registered pattern. None of these may turn a denied route into an allowed one.
  const variants = [
    '/api/v1/settings/export/',
    '/api/v1/settings//export',
    '//api/v1/settings/export',
    '/api/v1/settings/export?x=1',
    '/api/v1/settings/export;x=1',
    '/api/v1/settings/%65xport',
    '/api/v1/SETTINGS/export',
    '/API/V1/settings/export',
    '/api/v1/core/transactions/monthly-summary/../../settings/export',
    '/api/v1/core/transactions/monthly-summary/%2e%2e/%2e%2e/settings/export',
    '/api/v1/core/transactions/monthly-summary%2f..%2f..%2fsettings%2fexport',
    '/api/v1/p/acme.hostile/../../settings/export',
    '/api/v1/./settings/export',
    '/api/v1/settings/export%00',
    '/api/v1/settings/export#core',
  ]

  it.each(variants)('%s is never the export', async (url) => {
    for (const method of ['GET', 'HEAD'] as const) {
      const res = await app.inject({ method, url, headers: bearer(hostileToken) })
      expect(res.statusCode, `${method} ${url}`).not.toBe(200)
      expect(res.body).not.toContain(owner.email)
      expect(res.body).not.toContain('"transactions"')
    }
  })
})

describe('a plugin token on routes outside /api/v1', () => {
  it('opens nothing: health checks and the app shell take no credentials, and a bad route is a plain 404', async () => {
    for (const url of ['/healthz', '/readyz', '/definitely/not/a/route']) {
      const res = await app.inject({ method: 'GET', url, headers: bearer(hostileToken) })
      expect([200, 404], url).toContain(res.statusCode)
      expect(res.body).not.toContain(owner.email)
    }
  })
})
