import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asPlugin, createDb, type Db } from '../db/client.js'
import { pluginRoleName } from '../db/plugin-roles.js'
import { BUNDLED_PLUGINS } from './bundled.js'
import {
  TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser,
} from '../testing/harness.js'

/**
 * The owner-only plugin manager: listing every registered plugin and switching
 * one on or off, and what a switched-off plugin can and cannot still do.
 */

const BUDGETS = 'wickermoney.budgets'
const BUDGETS_BASE = `/api/v1/p/${BUDGETS}`

let h: Harness
let admin: Db
let owner: TestUser
let member: TestUser
let groceries: string

interface RegistryBody {
  plugins: Array<{
    id: string; name: string; version: string; bundled: boolean; enabled: boolean
    status: string; failure: string | null
    contributes: { pages: string[]; widgets: string[]; endpoints: boolean }
  }>
}

const registry = (u: TestUser) =>
  h.app.inject({ method: 'GET', url: '/api/v1/plugins/registry', headers: auth(u) })

const toggle = (u: TestUser, pluginId: string, payload: unknown) =>
  h.app.inject({ method: 'PATCH', url: `/api/v1/plugins/${pluginId}`, headers: auth(u), payload })

/** The plugin ids every signed-in app would load right now. */
async function loadedIds(u: TestUser): Promise<string[]> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/plugins', headers: auth(u) })
  expect(res.statusCode).toBe(200)
  return (res.json() as { plugins: Array<{ id: string }> }).plugins.map((p) => p.id)
}

const budgetsMonth = (u: TestUser) =>
  h.app.inject({
    method: 'GET', url: `${BUDGETS_BASE}/month?month=2026-05&tz=UTC`,
    headers: { ...auth(u), 'x-wickermoney-plugin': BUDGETS },
  })

async function setRole(u: TestUser, role: 'owner' | 'member'): Promise<void> {
  await sql`UPDATE core.users SET role = ${role}::core.user_role WHERE id = ${u.id}`.execute(admin)
}

async function enableAll(): Promise<void> {
  await sql`UPDATE core.plugins SET enabled = true`.execute(h.db)
}

beforeAll(async () => {
  const { seedBundledPlugins } = await import('./registry.js')
  h = await createHarness()
  await seedBundledPlugins(h.db)
  await enableAll()
  admin = createDb(TEST_ADMIN_DATABASE_URL)

  owner = await createUser(h)
  member = await createUser(h)
  // Only an instance's first account is registered as its owner, and the
  // shared test database has one already, so promote this fixture by hand as
  // the database owner (`core.users`' policy does not apply to it). The member
  // is set explicitly too, rather than relying on who registered first.
  await setRole(owner, 'owner')
  await setRole(member, 'member')

  const cat = await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(owner),
    payload: { name: 'Groceries', slug: 'groceries' },
  })
  expect(cat.statusCode).toBe(201)
  groceries = (cat.json() as { id: string }).id
})

afterAll(async () => {
  await enableAll()
  await admin.destroy()
  await h.close()
})

describe('listing every registered plugin', () => {
  it('shows an owner every bundled plugin with its manifest details and status', async () => {
    const res = await registry(owner)
    expect(res.statusCode).toBe(200)
    const body = res.json() as RegistryBody
    expect(body.plugins.map((p) => p.id).sort()).toEqual(BUNDLED_PLUGINS.map((m) => m.id).sort())
    expect(body.plugins.find((p) => p.id === BUDGETS)).toMatchObject({
      name: 'Budgets', version: '0.1.0', bundled: true, enabled: true, status: 'enabled', failure: null,
      contributes: { pages: ['Budgets'], widgets: ['Budget breakdown'], endpoints: true },
    })
  })

  it('refuses a member with 403 owner_required', async () => {
    const res = await registry(member)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('owner_required')
  })

  it('reads the role on every request, so a demotion applies without a new token', async () => {
    const promoted = await createUser(h)
    await setRole(promoted, 'owner')
    expect((await registry(promoted)).statusCode).toBe(200)
    await setRole(promoted, 'member')
    expect((await registry(promoted)).statusCode).toBe(403)
  })
})

describe('switching a plugin on or off', () => {
  it('refuses a member, and leaves the plugin as it was', async () => {
    const res = await toggle(member, BUDGETS, { enabled: false })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('owner_required')
    expect(await loadedIds(member)).toContain(BUDGETS)
  })

  it('answers 404 for an id that is not registered', async () => {
    const res = await toggle(owner, 'nobody.home', { enabled: false })
    expect(res.statusCode).toBe(404)
  })

  it.each([
    [{}],
    [{ enabled: 'false' }],
    [{ enabled: false, purge: true }],
  ])('answers 400 for the body %j', async (payload) => {
    const res = await toggle(owner, BUDGETS, payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('reports who changed what, and is idempotent', async () => {
    const off = await toggle(owner, 'wickermoney.insights', { enabled: false })
    expect(off.statusCode).toBe(200)
    const body = off.json()
    expect(body).toMatchObject({
      plugin: { id: 'wickermoney.insights', enabled: false, status: 'disabled' },
      previous: { enabled: true },
      changed: true,
      changedBy: { id: owner.id, email: owner.email },
    })
    expect(Number.isNaN(Date.parse(body.changedAt as string))).toBe(false)

    const again = await toggle(owner, 'wickermoney.insights', { enabled: false })
    expect(again.json()).toMatchObject({ previous: { enabled: false }, changed: false })

    expect((await toggle(owner, 'wickermoney.insights', { enabled: true })).json())
      .toMatchObject({ changed: true, plugin: { status: 'enabled' } })
  })
})

describe('a disabled plugin', () => {
  it('keeps its data, refuses its endpoints while off, and has everything back when re-enabled', async () => {
    const put = await h.app.inject({
      method: 'PUT', url: `${BUDGETS_BASE}/line`,
      headers: { ...auth(owner), 'x-wickermoney-plugin': BUDGETS },
      payload: { month: '2026-05', categoryId: groceries, planned: '400.0000', rollover: false },
    })
    expect(put.statusCode).toBe(200)
    expect((await budgetsMonth(owner)).statusCode).toBe(200)

    expect((await toggle(owner, BUDGETS, { enabled: false })).statusCode).toBe(200)

    // Gone from what every user's app loads, at once: the toggle clears this
    // process's registry cache.
    expect(await loadedIds(owner)).not.toContain(BUDGETS)
    expect(await loadedIds(member)).not.toContain(BUDGETS)

    // Its own routes answer a clear 404, not a 500.
    const refused = await budgetsMonth(owner)
    expect(refused.statusCode).toBe(404)
    expect(refused.json().code).toBe('plugin_disabled')

    // Core data routes refuse its identity, even for tables it is granted.
    const core = await h.app.inject({
      method: 'GET', url: '/api/v1/core/categories/list',
      headers: { ...auth(owner), 'x-wickermoney-plugin': BUDGETS },
    })
    expect(core.statusCode).toBe(403)
    expect(core.json().code).toBe('grant_denied')

    // Nothing was dropped: the row is still there, read under the plugin's
    // own role exactly as its routes would once it is back.
    const rows = await asPlugin(h.db, pluginRoleName(BUDGETS), owner.id, (trx) =>
      sql<{ planned: string }>`
        SELECT planned::text AS planned FROM plugin_budgets.budget_lines WHERE category_id = ${groceries}
      `.execute(trx))
    expect(rows.rows.map((r) => r.planned)).toEqual(['400.0000'])

    expect((await toggle(owner, BUDGETS, { enabled: true })).statusCode).toBe(200)
    expect(await loadedIds(member)).toContain(BUDGETS)

    const back = await budgetsMonth(owner)
    expect(back.statusCode).toBe(200)
    const line = (back.json() as { lines: Array<{ categoryId: string; planned: string }> })
      .lines.find((l) => l.categoryId === groceries)
    expect(line?.planned).toBe('400.0000')
  })

  it('stays disabled when the bundled plugins are seeded again, as on a restart', async () => {
    const { seedBundledPlugins } = await import('./registry.js')
    await toggle(owner, 'wickermoney.forecast', { enabled: false })

    await seedBundledPlugins(h.db)

    const body = (await registry(owner)).json() as RegistryBody
    expect(body.plugins.find((p) => p.id === 'wickermoney.forecast')).toMatchObject({ enabled: false, status: 'disabled' })
    expect(await loadedIds(owner)).not.toContain('wickermoney.forecast')

    await toggle(owner, 'wickermoney.forecast', { enabled: true })
  })
})
