import { decodeJwt } from 'jose'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grantsOfManifest } from '../auth/pluginGrants.js'
import { verifyPluginToken } from '../auth/pluginTokens.js'
import { verifyAccessToken } from '../auth/tokens.js'
import { createDb, type Db } from '../db/client.js'
import { TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { BUNDLED_PLUGINS } from './bundled.js'

/** Minting plugin tokens: who can ask, for which plugin, and what the token says. */

const INSIGHTS = 'wickermoney.insights'
const BUDGETS = 'wickermoney.budgets'

let h: Harness
let admin: Db
let user: TestUser
let owner: TestUser

const mint = (u: TestUser | undefined, pluginId: string) =>
  h.app.inject({
    method: 'POST',
    url: `/api/v1/plugins/${pluginId}/token`,
    headers: u === undefined ? {} : auth(u),
  })

const toggle = (pluginId: string, enabled: boolean) =>
  h.app.inject({ method: 'PATCH', url: `/api/v1/plugins/${pluginId}`, headers: auth(owner), payload: { enabled } })

beforeAll(async () => {
  const { seedBundledPlugins } = await import('./registry.js')
  h = await createHarness()
  await seedBundledPlugins(h.db)
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  user = await createUser(h)
  owner = await createUser(h)
  await sql`UPDATE core.users SET role = 'owner' WHERE id = ${owner.id}`.execute(admin)
})

afterAll(async () => {
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)
  await admin.destroy()
  await h.close()
})

describe('POST /api/v1/plugins/:pluginId/token', () => {
  it('mints a token for an enabled plugin, naming its grants and when it expires', async () => {
    const res = await mint(user, INSIGHTS)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { token: string; expiresAt: string; pluginId: string; grants: Array<{ table: string; access: string }> }
    expect(body.pluginId).toBe(INSIGHTS)
    expect(body.grants).toEqual([
      { table: 'transactions', access: 'read' },
      { table: 'categories', access: 'read' },
    ])
    const lifetimeMs = new Date(body.expiresAt).getTime() - Date.now()
    expect(lifetimeMs).toBeGreaterThan(4 * 60 * 1000)
    expect(lifetimeMs).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it('signs the user, the session, the plugin and exactly the manifest grants into the token', async () => {
    const res = await mint(user, INSIGHTS)
    const { token } = res.json() as { token: string }
    const claims = await verifyPluginToken(h.config, token)
    const manifest = BUNDLED_PLUGINS.find((m) => m.id === INSIGHTS)
    expect(claims).toEqual({
      sub: user.id,
      email: user.email,
      sid: decodeJwt(user.accessToken)['sid'],
      plg: INSIGHTS,
      tbl: grantsOfManifest(manifest ?? { requiredTables: [] }),
    })
    // Insights never asked for accounts, so its token cannot name them.
    expect(claims?.tbl).toEqual({ transactions: 'read', categories: 'read' })
  })

  it('signs the strongest level when a plugin asks for write', async () => {
    const claims = await verifyPluginToken(h.config, ((await mint(user, 'wickermoney.import-csv')).json() as { token: string }).token)
    expect(claims?.tbl).toMatchObject({ transactions: 'write', accounts: 'read' })
  })

  it('is not an access token: it has its own audience and no access token accepts it', async () => {
    const { token } = (await mint(user, INSIGHTS)).json() as { token: string }
    expect(decodeJwt(token).aud).not.toBe(h.config.AUTH_AUDIENCE)
    expect(await verifyAccessToken(h.config, token)).toBeNull()
  })

  it('answers 401 without a token and with a forged one', async () => {
    expect((await mint(undefined, INSIGHTS)).statusCode).toBe(401)
    const forged = await h.app.inject({
      method: 'POST', url: `/api/v1/plugins/${INSIGHTS}/token`, headers: { authorization: 'Bearer not-a-jwt' },
    })
    expect(forged.statusCode).toBe(401)
  })

  it('refuses a plugin token, so a plugin cannot mint itself a fresh one', async () => {
    const { token } = (await mint(user, INSIGHTS)).json() as { token: string }
    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/plugins/${INSIGHTS}/token`, headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('plugin_route_denied')
  })

  it('answers 404 not_found for a plugin id that was never registered', async () => {
    const res = await mint(user, 'nobody.home')
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('not_found')
  })

  it('refuses a plugin that is switched off with 404 plugin_disabled, and mints again once it is back on', async () => {
    expect((await toggle(BUDGETS, false)).statusCode).toBe(200)
    try {
      const res = await mint(user, BUDGETS)
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('plugin_disabled')
      expect(res.body).not.toContain('token')
    } finally {
      expect((await toggle(BUDGETS, true)).statusCode).toBe(200)
    }
    expect((await mint(user, BUDGETS)).statusCode).toBe(200)
  })

  it('refuses a plugin that is registered but whose manifest is no longer in the image', async () => {
    await sql`
      INSERT INTO core.plugins (plugin_id, version, bundled, enabled) VALUES ('ghost.plugin', '1.0.0', false, true)
      ON CONFLICT (plugin_id) DO UPDATE SET enabled = true
    `.execute(h.db)
    try {
      const res = await mint(user, 'ghost.plugin')
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('plugin_disabled')
    } finally {
      await sql`DELETE FROM core.plugins WHERE plugin_id = 'ghost.plugin'`.execute(h.db)
    }
  })

  it('binds the token to the session that asked, so each session gets its own', async () => {
    const other = await createUser(h)
    const a = await verifyPluginToken(h.config, ((await mint(user, INSIGHTS)).json() as { token: string }).token)
    const b = await verifyPluginToken(h.config, ((await mint(other, INSIGHTS)).json() as { token: string }).token)
    expect(a?.sub).toBe(user.id)
    expect(b?.sub).toBe(other.id)
    expect(a?.sid).not.toBe(b?.sid)
  })
})
