import { decodeJwt } from 'jose'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SDK_MAJOR_VERSION } from '@wickermoney/plugin-sdk'
import { buildApp } from '../app.js'
import { createDb, type Db } from '../db/client.js'
import { seedHousehold } from '../testing/eraseFixtures.js'
import { TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { exportAs } from '../testing/exportTicket.js'
import { BUNDLED_PLUGINS } from './bundled.js'
import { seedBundledPlugins } from './registry.js'
import type { ExternalPlugin } from './service/ExternalPlugin.js'

/**
 * ADR 0005, stage 5: a plugin the image did not ship, read from the operator's
 * manifest directory, through the real API and PostgreSQL.
 *
 * What it proves: it is registered switched off, an owner switches it on, it is
 * always isolated, its token carries only its grant, it has no server half and
 * no place in the export, and a hand-written manifest that asks for more is
 * refused with a reason.
 */

const ORIGIN = 'https://plugins.example.com'
const PIN = { 'remoteEntry.js': `sha384-${'A'.repeat(64)}` }
const ID = 'acme.report'
const CRAFTED = ['acme.server', 'acme.inrealm', 'acme.nopin', 'acme.elsewhere', 'acme.network'] as const

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: 'Report', version: '1.0.0', description: 'x', author: 'acme', sdkVersion: SDK_MAJOR_VERSION,
  requiredTables: [{ table: 'transactions', access: 'read' }], permissions: [],
  remoteEntry: `${ORIGIN}/${id}/remoteEntry.js`, integrity: PIN,
  contributes: { pages: [], widgets: [{ id: 'w', slot: 'dashboard.primary', title: 'W', module: './W' }], endpoints: false, exporters: false },
  ...extra,
})

const external: ExternalPlugin[] = [
  { source: 'report.json', manifest: manifest(ID) },
  { source: 'server.json', manifest: manifest('acme.server', { contributes: { pages: [], widgets: [], endpoints: true, exporters: true } }) },
  { source: 'inrealm.json', manifest: manifest('acme.inrealm', { isolated: false }) },
  { source: 'nopin.json', manifest: manifest('acme.nopin', { integrity: undefined }) },
  { source: 'elsewhere.json', manifest: manifest('acme.elsewhere', { remoteEntry: 'https://not-allowed.example.net/remoteEntry.js' }) },
  { source: 'network.json', manifest: manifest('acme.network', { permissions: ['network:outbound'] }) },
  // The id of a bundled plugin, from a manifest that is not the bundled one.
  { source: 'shadow.json', manifest: manifest('wickermoney.budgets', { name: 'Not budgets' }) },
]

let h: Harness
let admin: Db
let app: ReturnType<typeof buildApp>
let owner: TestUser
let previousOwners: string[] = []

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })
const list = async () => (await app.inject({ method: 'GET', url: '/api/v1/plugins', headers: auth(owner) })).json() as {
  plugins: Array<{ id: string; name: string; bundled: boolean; runtime: string; integrity?: Record<string, string> }>
  failures: Array<{ pluginId: string; reason: string }>
}

beforeAll(async () => {
  h = await createHarness({ PLUGIN_REMOTE_ORIGINS: ORIGIN })
  app = buildApp({ db: h.db, config: h.config, pluginOptions: { external } })
  await app.ready()
  await seedBundledPlugins(h.db, { external })
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  owner = await createUser(h)
  const { rows } = await sql<{ id: string }>`UPDATE core.users SET role = 'member' WHERE role = 'owner' RETURNING id`.execute(admin)
  previousOwners = rows.map((r) => r.id)
  await sql`UPDATE core.users SET role = 'owner' WHERE id = ${owner.id}::uuid`.execute(admin)
  await seedHousehold(h, owner, 'external')
  // Switched on before the registry is first read (it is cached for a few seconds), as an owner would have.
  await sql`UPDATE core.plugins SET enabled = true WHERE plugin_id = ANY(${[...CRAFTED]})`.execute(admin)
})

afterAll(async () => {
  await sql`DELETE FROM core.plugins WHERE plugin_id = ANY(${[ID, ...CRAFTED]})`.execute(admin)
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)
  await sql`UPDATE core.users SET role = 'member' WHERE role = 'owner'`.execute(admin)
  if (previousOwners.length > 0) await sql`UPDATE core.users SET role = 'owner' WHERE id = ANY(${previousOwners}::uuid[])`.execute(admin)
  await admin.destroy()
  await app.close()
  await h.close()
})

describe('a third-party plugin from the manifest directory', () => {
  it('is registered switched off, and not as bundled', async () => {
    const { rows } = await sql<{ enabled: boolean; bundled: boolean }>`SELECT enabled, bundled FROM core.plugins WHERE plugin_id = ${ID}`.execute(admin)
    expect(rows).toEqual([{ enabled: false, bundled: false }])
    expect((await list()).plugins.find((p) => p.id === ID)).toBeUndefined()
  })

  it('stays off across a restart that seeds it again', async () => {
    await seedBundledPlugins(h.db, { external })
    const { rows } = await sql<{ enabled: boolean }>`SELECT enabled FROM core.plugins WHERE plugin_id = ${ID}`.execute(admin)
    expect(rows[0]?.enabled).toBe(false)
  })

  it('is switched on by an owner, and then listed as isolated with its pin', async () => {
    const on = await app.inject({ method: 'PATCH', url: `/api/v1/plugins/${ID}`, headers: auth(owner), payload: { enabled: true } })
    expect(on.statusCode).toBe(200)
    const found = (await list()).plugins.find((p) => p.id === ID)
    expect(found).toMatchObject({ bundled: false, runtime: 'isolated', integrity: PIN })
  })

  it('gets a token with its own grant and nothing else', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/plugins/${ID}/token`, headers: auth(owner) })
    expect(res.statusCode).toBe(200)
    const token = (res.json() as { token: string }).token
    expect(decodeJwt(token)).toMatchObject({ plg: ID, tbl: { transactions: 'read' } })
    const granted = await app.inject({ method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1', headers: bearer(token) })
    expect(granted.statusCode).toBe(200)
    const ungranted = await app.inject({ method: 'GET', url: '/api/v1/core/accounts/summary', headers: bearer(token) })
    expect(ungranted.statusCode).toBe(403)
    expect(ungranted.json()).toMatchObject({ code: 'grant_denied' })
    const settings = await app.inject({ method: 'GET', url: '/api/v1/settings/export', headers: bearer(token) })
    expect(settings.statusCode).toBe(403)
  })

  it('has no server half: nothing is mounted under its namespace', async () => {
    const token = (await app.inject({ method: 'POST', url: `/api/v1/plugins/${ID}/token`, headers: auth(owner) })).json<{ token: string }>().token
    for (const method of ['GET', 'POST', 'PUT'] as const) {
      const res = await app.inject({ method, url: `/api/v1/p/${ID}/anything`, headers: bearer(token), payload: method === 'GET' ? undefined : {} })
      expect(res.statusCode, method).toBe(404)
    }
  })

  it('is not in the full export, which only carries what an exporter contributes', async () => {
    const res = await exportAs(app, owner)
    expect(res.statusCode).toBe(200)
    const plugins = (res.json() as { plugins: Record<string, unknown> }).plugins
    expect(Object.keys(plugins)).not.toContain(ID)
  })

  it('has no schema or database role of its own', async () => {
    const { rows } = await sql<{ n: string }>`SELECT count(*)::text AS n FROM pg_namespace WHERE nspname LIKE ${'plugin_acme%'}`.execute(admin)
    expect(rows[0]?.n).toBe('0')
  })

  it('does not replace the bundled plugin that shares an id with a hand-written manifest', async () => {
    const budgets = (await list()).plugins.find((p) => p.id === 'wickermoney.budgets')
    expect(budgets?.name).not.toBe('Not budgets')
    expect(budgets?.bundled).toBe(true)
    expect(BUNDLED_PLUGINS.some((m) => m.id === 'wickermoney.budgets')).toBe(true)
  })
})

describe('a hand-written manifest that asks for more', () => {
  it.each([
    ['server code (endpoints and exporters)', 'acme.server', /server half|no server/],
    ['no integrity pin', 'acme.nopin', /integrity pin/],
    ['an origin the operator did not allow', 'acme.elsewhere', /origin|allow/i],
    ['a permission the host does not implement', 'acme.network', /network:outbound/],
  ])('is refused for %s, with the reason', async (_what, id, reason) => {
    const body = await list()
    expect(body.plugins.find((p) => p.id === id)).toBeUndefined()
    expect(body.failures.find((f) => f.pluginId === id)?.reason).toMatch(reason)
    const mint = await app.inject({ method: 'POST', url: `/api/v1/plugins/${id}/token`, headers: auth(owner) })
    expect(mint.statusCode).not.toBe(200)
  })

  it('still runs isolated when it says isolated: false', async () => {
    const found = (await list()).plugins.find((p) => p.id === 'acme.inrealm')
    expect(found?.runtime).toBe('isolated')
    expect(found?.bundled).toBe(false)
  })
})
