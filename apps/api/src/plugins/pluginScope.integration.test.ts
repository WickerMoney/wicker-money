import { decodeJwt } from 'jose'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { PLUGIN_ROUTE_ACCESS } from '../auth/pluginRouteAccess.js'
import { signPluginToken } from '../auth/pluginTokens.js'
import { BUNDLED_PLUGINS } from './bundled.js'
import { asUser, createDb, type Db } from '../db/client.js'
import { configureTenantContext } from '../db/configureTenantContext.js'
import { installTenantContextKey } from '../db/installTenantContextKey.js'
import {
  TEST_ADMIN_DATABASE_URL,
  TEST_AUTH_SECRET,
  auth,
  createHarness,
  createUser,
  type Harness,
  type TestUser,
} from '../testing/harness.js'

/**
 * What a plugin token can and cannot do, end to end against PostgreSQL: it
 * reaches the tables its plugin was granted and its own namespace, and nothing
 * else, and the identity comes from the signed token alone.
 */

const INSIGHTS = 'wickermoney.insights'
const BUDGETS = 'wickermoney.budgets'
const DEBT = 'wickermoney.debt-payoff'
const UPCOMING = 'wickermoney.upcoming'

let h: Harness
let admin: Db
let alice: TestUser
let bob: TestUser
let owner: TestUser

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Mints a plugin token for `user` through the real route. */
async function mint(user: TestUser, pluginId: string): Promise<string> {
  const res = await h.app.inject({ method: 'POST', url: `/api/v1/plugins/${pluginId}/token`, headers: auth(user) })
  if (res.statusCode !== 200) throw new Error(`mint failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { token: string }).token
}

/** Calls the API with a plugin token, as the host's broker would. */
function asToken(token: string, method: Method, url: string, extra: Record<string, string> = {}, payload?: unknown) {
  return h.app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...extra },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  })
}

const toggle = (pluginId: string, enabled: boolean) =>
  h.app.inject({ method: 'PATCH', url: `/api/v1/plugins/${pluginId}`, headers: auth(owner), payload: { enabled } })

async function account(u: TestUser, name: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(u),
    payload: { name, accountType: 'checking', initialBalance: '0.00' },
  })
  if (res.statusCode !== 201) throw new Error(`account failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

beforeAll(async () => {
  const { seedBundledPlugins } = await import('./registry.js')
  h = await createHarness()
  await seedBundledPlugins(h.db)
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  alice = await createUser(h)
  bob = await createUser(h)
  owner = await createUser(h)
  await sql`UPDATE core.users SET role = 'owner' WHERE id = ${owner.id}`.execute(admin)
  await account(alice, 'Alice Checking')
  await account(bob, 'Bob Savings')
})

afterAll(async () => {
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)
  configureTenantContext(TEST_AUTH_SECRET)
  await installTenantContextKey(admin)
  await admin.destroy()
  await h.close()
})

describe('a valid token and the tables its plugin was granted', () => {
  it('reaches a granted table and is refused an ungranted one', async () => {
    const token = await mint(alice, INSIGHTS) // transactions + categories, read
    expect((await asToken(token, 'GET', '/api/v1/core/transactions/monthly-summary')).statusCode).toBe(200)
    expect((await asToken(token, 'GET', '/api/v1/core/categories/list')).statusCode).toBe(200)

    const denied = await asToken(token, 'GET', '/api/v1/core/accounts/list')
    expect(denied.statusCode).toBe(403)
    expect(denied.json().code).toBe('grant_denied')
    expect(denied.json().message).toContain("'accounts'")
    expect((await asToken(token, 'GET', '/api/v1/core/accounts/summary')).statusCode).toBe(403)
    expect((await asToken(token, 'GET', '/api/v1/core/recurring-items/list')).statusCode).toBe(403)
  })

  it('needs every table a route reads: upcoming wants recurring items and accounts', async () => {
    const both = await mint(alice, UPCOMING)
    expect((await asToken(both, 'GET', '/api/v1/core/recurring-items/upcoming')).statusCode).toBe(200)
    // Insights holds neither, budgets holds accounts but not recurring items.
    const budgets = await mint(alice, BUDGETS)
    const res = await asToken(budgets, 'GET', '/api/v1/core/recurring-items/upcoming')
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('grant_denied')
  })

  it('serves every plugin-accessible /core route to a token that holds exactly its tables, and refuses it with any one table missing', async () => {
    const accessible = Object.entries(PLUGIN_ROUTE_ACCESS).filter(([, rule]) => rule.kind === 'core')
    expect(accessible).toHaveLength(8)
    for (const [route, rule] of accessible) {
      if (rule.kind !== 'core') continue
      const url = route.slice(route.indexOf(' ') + 1)
      // The route table says which tables are needed; the handler's own guards
      // must agree. Use real bundled plugins that hold supersets/subsets.
      const needed = rule.needs.map((n) => n.table)
      const holders = ['wickermoney.insights', 'wickermoney.spending-trends', 'wickermoney.budgets', 'wickermoney.upcoming', 'wickermoney.forecast', 'wickermoney.import-csv']
      let served = 0
      for (const id of holders) {
        const manifest = BUNDLED_PLUGINS.find((m) => m.id === id)
        const has = new Set(manifest?.requiredTables.map((g) => g.table))
        const res = await asToken(await mint(alice, id), 'GET', url)
        if (needed.every((t) => has.has(t))) {
          expect(res.statusCode, `${route} for ${id}`).toBe(200)
          served += 1
        } else {
          expect(res.statusCode, `${route} for ${id}`).toBe(403)
          expect(res.json().code, `${route} for ${id}`).toBe('grant_denied')
        }
      }
      expect(served, `${route} is served to no bundled plugin`).toBeGreaterThan(0)
    }
  })

  it('narrows a token to the manifest: claims beyond what the plugin asks for do nothing', async () => {
    const sid = decodeJwt(alice.accessToken)['sid'] as string
    const { token } = await signPluginToken(h.config, {
      sub: alice.id, email: alice.email, sid, plg: INSIGHTS,
      tbl: { transactions: 'write', categories: 'read', accounts: 'write' },
    })
    // Accounts was never in insights' manifest, so the signed claim is not honoured.
    const res = await asToken(token, 'GET', '/api/v1/core/accounts/list')
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('grant_denied')
    // What the manifest does grant still works.
    expect((await asToken(token, 'GET', '/api/v1/core/transactions/monthly-summary')).statusCode).toBe(200)
  })

  it('does not take the plugin from the advisory header', async () => {
    const token = await mint(alice, INSIGHTS)
    // Budgets is granted accounts, insights is not. Naming budgets changes nothing.
    const res = await asToken(token, 'GET', '/api/v1/core/accounts/list', { 'x-wickermoney-plugin': BUDGETS })
    expect(res.statusCode).toBe(403)
    // Omitting or garbling the header changes nothing either.
    expect((await asToken(token, 'GET', '/api/v1/core/transactions/monthly-summary', { 'x-wickermoney-plugin': '' })).statusCode).toBe(200)
    expect((await asToken(token, 'GET', '/api/v1/core/transactions/monthly-summary', { 'x-wickermoney-plugin': 'nobody.here' })).statusCode).toBe(200)
  })

  it('answers a HEAD request the way it answers the GET', async () => {
    const token = await mint(alice, INSIGHTS)
    expect((await asToken(token, 'HEAD' as Method, '/api/v1/core/transactions/monthly-summary')).statusCode).toBe(200)
    expect((await asToken(token, 'HEAD' as Method, '/api/v1/core/accounts/list')).statusCode).toBe(403)
  })
})

describe('a token stolen from one plugin', () => {
  it('cannot call another plugin’s routes', async () => {
    const insights = await mint(alice, INSIGHTS)
    const budgets = await mint(alice, BUDGETS)

    const intoBudgets = await asToken(insights, 'GET', `/api/v1/p/${BUDGETS}/month?month=2026-05&tz=UTC`)
    expect(intoBudgets.statusCode).toBe(403)
    expect(intoBudgets.json().code).toBe('plugin_route_denied')

    const intoDebt = await asToken(budgets, 'GET', `/api/v1/p/${DEBT}/debts`)
    expect(intoDebt.statusCode).toBe(403)
    expect(intoDebt.json().code).toBe('plugin_route_denied')

    // A header naming the victim does not help.
    const withHeader = await asToken(budgets, 'POST', `/api/v1/p/${DEBT}/debts`, { 'x-wickermoney-plugin': DEBT },
      { name: 'Planted', balance: '1', apr: '1', minimumPayment: '1' })
    expect(withHeader.statusCode).toBe(403)
    const listed = await h.app.inject({ method: 'GET', url: `/api/v1/p/${DEBT}/debts`, headers: auth(alice) })
    expect((listed.json() as { debts: Array<{ name: string }> }).debts.map((d) => d.name)).not.toContain('Planted')
  })

  it('cannot reach another plugin’s tables through the core routes', async () => {
    const budgets = await mint(alice, BUDGETS) // holds accounts
    const insights = await mint(alice, INSIGHTS) // does not
    expect((await asToken(budgets, 'GET', '/api/v1/core/accounts/list')).statusCode).toBe(200)
    expect((await asToken(insights, 'GET', '/api/v1/core/accounts/list')).statusCode).toBe(403)
  })

  it('still reaches its own namespace', async () => {
    const budgets = await mint(alice, BUDGETS)
    const res = await asToken(budgets, 'GET', `/api/v1/p/${BUDGETS}/month?month=2026-05&tz=UTC`)
    expect(res.statusCode).toBe(200)
  })

  it('cannot be forged by editing the plugin claim, because the signature covers it', async () => {
    const real = await mint(alice, INSIGHTS)
    const [header, , signature] = real.split('.') as [string, string, string]
    const claims = decodeJwt(real)
    const edited = Buffer.from(JSON.stringify({ ...claims, plg: BUDGETS })).toString('base64url')
    const res = await asToken(`${header}.${edited}.${signature}`, 'GET', `/api/v1/p/${BUDGETS}/month?month=2026-05&tz=UTC`)
    expect(res.statusCode).toBe(401)
  })

  it('cannot be forged with a key other than the server’s', async () => {
    const { signPluginToken: sign } = await import('../auth/pluginTokens.js')
    const { loadConfig } = await import('../config.js')
    const other = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://unused@localhost/unused',
      AUTH_SECRET: 'an-attacker-guessed-this-secret-0000000000',
    } as NodeJS.ProcessEnv)
    const { token } = await sign(other, {
      sub: alice.id, email: alice.email, sid: decodeJwt(alice.accessToken)['sid'] as string, plg: BUDGETS,
      tbl: { accounts: 'write', transactions: 'write' },
    })
    expect((await asToken(token, 'GET', '/api/v1/core/accounts/list')).statusCode).toBe(401)
  })
})

describe('an expired or revoked token', () => {
  it('answers 401 once the token has expired, on core and plugin routes alike', async () => {
    const sid = decodeJwt(alice.accessToken)['sid'] as string
    const { token } = await signPluginToken(
      h.config,
      { sub: alice.id, email: alice.email, sid, plg: BUDGETS, tbl: { transactions: 'read', categories: 'read', accounts: 'read' } },
      { now: new Date(Date.now() - 10 * 60 * 1000) },
    )
    const core = await asToken(token, 'GET', '/api/v1/core/accounts/list')
    expect(core.statusCode).toBe(401)
    expect(core.json().code).toBe('unauthorized')
    expect((await asToken(token, 'GET', `/api/v1/p/${BUDGETS}/month?month=2026-05&tz=UTC`)).statusCode).toBe(401)
  })

  it('stops working when the session it was minted under ends', async () => {
    const carol = await createUser(h)
    const token = await mint(carol, INSIGHTS)
    expect((await asToken(token, 'GET', '/api/v1/core/transactions/monthly-summary')).statusCode).toBe(200)

    const logout = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/logout', cookies: { wickermoney_refresh: carol.refreshToken },
      headers: { 'x-wickermoney-csrf': '1' },
    })
    expect(logout.statusCode).toBeLessThan(300)
    // The host token dies with the session, and so does the plugin's.
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(carol) })).statusCode).toBe(401)
    expect((await asToken(token, 'GET', '/api/v1/core/transactions/monthly-summary')).statusCode).toBe(401)
  })
})

describe('a token for a plugin that is switched off', () => {
  it('is refused on core and plugin routes, and works again when the plugin is back on', async () => {
    const token = await mint(alice, BUDGETS)
    expect((await asToken(token, 'GET', '/api/v1/core/accounts/list')).statusCode).toBe(200)

    expect((await toggle(BUDGETS, false)).statusCode).toBe(200)
    try {
      const core = await asToken(token, 'GET', '/api/v1/core/accounts/list')
      expect(core.statusCode).toBe(403)
      expect(core.json().code).toBe('plugin_disabled')
      const own = await asToken(token, 'GET', `/api/v1/p/${BUDGETS}/month?month=2026-05&tz=UTC`)
      expect(own.statusCode).toBe(403)
      expect(own.json().code).toBe('plugin_disabled')
    } finally {
      expect((await toggle(BUDGETS, true)).statusCode).toBe(200)
    }
    expect((await asToken(token, 'GET', '/api/v1/core/accounts/list')).statusCode).toBe(200)
  })

  it('does not stop other plugins’ tokens', async () => {
    const insights = await mint(alice, INSIGHTS)
    expect((await toggle(BUDGETS, false)).statusCode).toBe(200)
    try {
      expect((await asToken(insights, 'GET', '/api/v1/core/transactions/monthly-summary')).statusCode).toBe(200)
    } finally {
      await toggle(BUDGETS, true)
    }
  })
})

describe('what no plugin token may call', () => {
  /** A concrete URL for a route pattern. */
  const concrete = (pattern: string): string =>
    pattern
      .replace(':date', '2026-01-01')
      .replace(/:pluginId/, INSIGHTS)
      .replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000')

  const denied = Object.entries(PLUGIN_ROUTE_ACCESS)
    .filter(([, rule]) => rule.kind === 'denied')
    .map(([route]) => route.split(' ') as [Method, string])

  it('refuses every route classified as denied, with 403 plugin_route_denied, even for an owner’s token', async () => {
    expect(denied.length).toBeGreaterThan(60)
    // The owner's own plugin token carries the owner's identity but not the owner's powers.
    const token = await mint(owner, BUDGETS)
    for (const [method, pattern] of denied) {
      const res = await asToken(token, method, concrete(pattern), { 'x-wickermoney-csrf': '1' }, method === 'GET' || method === 'DELETE' ? undefined : { enabled: false })
      expect(res.statusCode, `${method} ${pattern}`).toBe(403)
      expect(res.json().code, `${method} ${pattern}`).toBe('plugin_route_denied')
    }
  })

  it('did not run any of those handlers', async () => {
    // The loop above would have switched insights off, demoted the owner, rotated sessions
    // and written data if a single handler had run.
    const plugins = await h.app.inject({ method: 'GET', url: '/api/v1/plugins', headers: auth(owner) })
    expect((plugins.json() as { plugins: Array<{ id: string }> }).plugins.map((p) => p.id)).toContain(INSIGHTS)
    const me = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(owner) })
    expect(me.json()).toMatchObject({ role: 'owner' })
  })

  it('cannot call /auth/refresh to obtain a host token, and does not rotate the refresh token', async () => {
    const dave = await createUser(h)
    const token = await mint(dave, INSIGHTS)
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      headers: { authorization: `Bearer ${token}`, 'x-wickermoney-csrf': '1' },
      cookies: { wickermoney_refresh: dave.refreshToken },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('plugin_route_denied')
    expect(res.json()).not.toHaveProperty('accessToken')
    // The same cookie still refreshes, so the denied call did not consume it.
    const legit = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      headers: { 'x-wickermoney-csrf': '1' }, cookies: { wickermoney_refresh: dave.refreshToken },
    })
    expect(legit.statusCode).toBe(200)
  })

  it('cannot export the user’s data', async () => {
    const token = await mint(alice, INSIGHTS)
    const res = await asToken(token, 'GET', '/api/v1/settings/export')
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('plugin_route_denied')
    expect(res.body).not.toContain('Alice Checking')
  })

  it('cannot manage plugins or mint another token', async () => {
    const token = await mint(owner, INSIGHTS)
    for (const [method, url, payload] of [
      ['GET', '/api/v1/plugins/registry', undefined],
      ['PATCH', `/api/v1/plugins/${INSIGHTS}`, { enabled: false }],
      ['POST', `/api/v1/plugins/${BUDGETS}/token`, undefined],
    ] as const) {
      const res = await asToken(token, method, url, {}, payload)
      expect(res.statusCode, `${method} ${url}`).toBe(403)
      expect(res.json().code).toBe('plugin_route_denied')
    }
  })

  it('cannot read or write the user’s data through the host’s own routes', async () => {
    const token = await mint(alice, BUDGETS)
    expect((await asToken(token, 'GET', '/api/v1/accounts')).statusCode).toBe(403)
    expect((await asToken(token, 'GET', '/api/v1/transactions')).statusCode).toBe(403)
    expect((await asToken(token, 'POST', '/api/v1/accounts', {}, { name: 'Planted', accountType: 'checking', initialBalance: '0' })).statusCode).toBe(403)
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(alice) })
    expect((list.json() as Array<{ name: string }>).map((a) => a.name)).not.toContain('Planted')
  })

  it('refuses a route that was never classified, even if its handler would accept plugin callers', async () => {
    // A second app on the same database with one extra, unlisted route whose handler
    // resolves the actor the way a plugin-serving handler does. Only the hook stands in the way.
    const extra = buildApp({ db: h.db, config: h.config })
    extra.get('/api/v1/__unclassified', async (request) => {
      const actor = await extra.requireActor(request)
      return { ok: true, plugin: actor.plugin?.pluginId ?? null }
    })
    await extra.ready()
    try {
      const token = await mint(alice, INSIGHTS)
      const asPlugin = await extra.inject({ method: 'GET', url: '/api/v1/__unclassified', headers: { authorization: `Bearer ${token}` } })
      expect(asPlugin.statusCode).toBe(403)
      expect(asPlugin.json().code).toBe('plugin_route_denied')
      // The host is unaffected: the same route answers its own token.
      const asHost = await extra.inject({ method: 'GET', url: '/api/v1/__unclassified', headers: auth(alice) })
      expect(asHost.statusCode).toBe(200)
      expect(asHost.json()).toEqual({ ok: true, plugin: null })
    } finally {
      await extra.close()
    }
  })
})

describe('two users', () => {
  it('gives each token only its own user’s rows', async () => {
    const forAlice = await mint(alice, BUDGETS)
    const forBob = await mint(bob, BUDGETS)

    const a = (await asToken(forAlice, 'GET', '/api/v1/core/accounts/list')).json() as { accounts: Array<{ name: string }> }
    const b = (await asToken(forBob, 'GET', '/api/v1/core/accounts/list')).json() as { accounts: Array<{ name: string }> }
    expect(a.accounts.map((x) => x.name)).toContain('Alice Checking')
    expect(a.accounts.map((x) => x.name)).not.toContain('Bob Savings')
    expect(b.accounts.map((x) => x.name)).toContain('Bob Savings')
    expect(b.accounts.map((x) => x.name)).not.toContain('Alice Checking')
  })

  it('keeps one user’s debts out of another user’s plugin token', async () => {
    const forAlice = await mint(alice, DEBT)
    const forBob = await mint(bob, DEBT)
    const created = await asToken(forAlice, 'POST', `/api/v1/p/${DEBT}/debts`, {},
      { name: 'Alice Visa', balance: '500.00', apr: '10', minimumPayment: '25.00' })
    expect(created.statusCode).toBe(200)
    const id = (created.json() as { id: string }).id

    const bobList = (await asToken(forBob, 'GET', `/api/v1/p/${DEBT}/debts`)).json() as { debts: Array<{ id: string }> }
    expect(bobList.debts.map((d) => d.id)).not.toContain(id)
    expect((await asToken(forBob, 'GET', `/api/v1/p/${DEBT}/debts/${id}`)).statusCode).toBe(404)
    expect((await asToken(forBob, 'DELETE', `/api/v1/p/${DEBT}/debts/${id}`)).statusCode).toBe(404)
    expect((await asToken(forAlice, 'GET', `/api/v1/p/${DEBT}/debts/${id}`)).statusCode).toBe(200)
  })

  it('cannot be pointed at another user by editing the subject, because the signature covers it', async () => {
    const real = await mint(alice, BUDGETS)
    const [header, , signature] = real.split('.') as [string, string, string]
    const edited = Buffer.from(JSON.stringify({ ...decodeJwt(real), sub: bob.id })).toString('base64url')
    expect((await asToken(`${header}.${edited}.${signature}`, 'GET', '/api/v1/core/accounts/list')).statusCode).toBe(401)
  })
})

describe('a write followed by a fresh read', () => {
  it('shows a write made with one token to a read made with a newly minted one, and to the host', async () => {
    const writer = await mint(alice, DEBT)
    const created = await asToken(writer, 'POST', `/api/v1/p/${DEBT}/debts`, {},
      { name: 'Fresh read card', balance: '250.00', apr: '18', minimumPayment: '15.00' })
    expect(created.statusCode).toBe(200)
    const id = (created.json() as { id: string }).id

    const reader = await mint(alice, DEBT)
    expect(reader).not.toBe(writer)
    const seen = (await asToken(reader, 'GET', `/api/v1/p/${DEBT}/debts`)).json() as { debts: Array<{ id: string; balance: string }> }
    expect(seen.debts.find((d) => d.id === id)?.balance).toBe('250.0000')

    const host = (await h.app.inject({ method: 'GET', url: `/api/v1/p/${DEBT}/debts`, headers: auth(alice) })).json() as { debts: Array<{ id: string }> }
    expect(host.debts.map((d) => d.id)).toContain(id)

    const updated = await asToken(writer, 'PUT', `/api/v1/p/${DEBT}/debts/${id}`, {}, { balance: '200.00' })
    expect(updated.statusCode).toBe(200)
    const again = (await asToken(await mint(alice, DEBT), 'GET', `/api/v1/p/${DEBT}/debts/${id}`)).json() as { balance: string }
    expect(again.balance).toBe('200.0000')

    expect((await asToken(writer, 'DELETE', `/api/v1/p/${DEBT}/debts/${id}`)).statusCode).toBe(200)
    expect((await asToken(await mint(alice, DEBT), 'GET', `/api/v1/p/${DEBT}/debts/${id}`)).statusCode).toBe(404)
  })

  it('reads core data fresh after the host changes it, with no stale answer held for the token', async () => {
    const token = await mint(bob, BUDGETS)
    const before = (await asToken(token, 'GET', '/api/v1/core/accounts/list')).json() as { accounts: unknown[] }
    await account(bob, 'Bob Brokerage')
    const after = (await asToken(token, 'GET', '/api/v1/core/accounts/list')).json() as { accounts: Array<{ name: string }> }
    expect(after.accounts).toHaveLength(before.accounts.length + 1)
    expect(after.accounts.map((a) => a.name)).toContain('Bob Brokerage')
  })
})

describe('the signed tenant context on plugin-token requests', () => {
  it('is bound per request: with no key installed, a plugin token sees no rows', async () => {
    const token = await mint(alice, DEBT)
    const mine = await asToken(token, 'POST', `/api/v1/p/${DEBT}/debts`, {},
      { name: 'Signed context card', balance: '10.00', apr: '1', minimumPayment: '1.00' })
    expect(mine.statusCode).toBe(200)

    const names = async () =>
      ((await asToken(token, 'GET', `/api/v1/p/${DEBT}/debts`)).json() as { debts: Array<{ name: string }> }).debts.map((d) => d.name)
    expect(await names()).toContain('Signed context card')

    await sql`DELETE FROM core.tenant_context_key`.execute(admin)
    try {
      // The token is still valid; only the database can no longer verify the signed
      // tenant, so row-level security shows the plugin nothing at all.
      expect(await names()).toEqual([])
      const accounts = (await asToken(await mint(alice, BUDGETS), 'GET', '/api/v1/core/accounts/list')).json() as { accounts: unknown[] }
      expect(accounts.accounts).toEqual([])
    } finally {
      configureTenantContext(TEST_AUTH_SECRET)
      await installTenantContextKey(admin)
    }
    expect(await names()).toContain('Signed context card')
  })

  it('leaves no tenant bound on the pooled connection after a plugin-token request', async () => {
    const token = await mint(alice, DEBT)
    await asToken(token, 'GET', `/api/v1/p/${DEBT}/debts`)
    const idle = await sql<{ id: string | null }>`SELECT core.current_user_id() AS id`.execute(h.db)
    expect(idle.rows[0]?.id).toBeNull()
    // And the same user is reachable only through a freshly signed context.
    const seen = await asUser(h.db, alice.id, async (trx) => (await sql<{ n: string }>`SELECT count(*) AS n FROM core.accounts`.execute(trx)).rows[0]?.n)
    expect(Number(seen)).toBeGreaterThan(0)
  })
})
