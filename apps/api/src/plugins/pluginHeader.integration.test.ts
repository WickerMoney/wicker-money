import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

const DISABLED = 'wickermoney.budgets'

let h: Harness
let user: TestUser

async function setEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await sql`UPDATE core.plugins SET enabled = ${enabled} WHERE plugin_id = ${pluginId}`.execute(h.db)
}

beforeAll(async () => {
  const { seedBundledPlugins } = await import('./registry.js')
  h = await createHarness()
  await seedBundledPlugins(h.db)
  // Toggled before the app's first registry read, so the app's short-lived
  // registry cache cannot hold an older answer.
  await setEnabled(DISABLED, false)
  user = await createUser(h)
})
afterAll(async () => {
  await setEnabled(DISABLED, true)
  await h.close()
})

const CORE_ROUTES = [
  '/api/v1/core/transactions/monthly-summary',
  '/api/v1/core/accounts/summary',
  '/api/v1/core/accounts/list',
  '/api/v1/core/categories/list',
]

function core(url: string, headers: Record<string, string | string[]>) {
  return h.app.inject({ method: 'GET', url, headers: { ...auth(user), ...headers } })
}

describe('the x-wickermoney-plugin header on core data routes', () => {
  it.each(CORE_ROUTES)('%s refuses a plugin that is disabled, even if its manifest grants the table', async (url) => {
    // Budgets is granted transactions and categories, but it is switched off.
    const res = await core(url, { 'x-wickermoney-plugin': DISABLED })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('grant_denied')
    expect(res.json().message).toContain('not installed or not enabled')
  })

  it.each(CORE_ROUTES)('%s refuses a plugin id that does not exist', async (url) => {
    const res = await core(url, { 'x-wickermoney-plugin': 'nobody.here' })
    expect(res.statusCode).toBe(403)
  })

  it('refuses an empty header value instead of treating the caller as the host', async () => {
    const res = await core('/api/v1/core/accounts/summary', { 'x-wickermoney-plugin': '' })
    expect(res.statusCode).toBe(403)
  })

  it('refuses a header repeated with different plugins', async () => {
    const res = await core('/api/v1/core/transactions/monthly-summary', {
      'x-wickermoney-plugin': ['wickermoney.insights', 'wickermoney.budgets'],
    })
    expect(res.statusCode).toBe(403)
  })

  it('still serves an enabled plugin its granted table, and the host with no header', async () => {
    expect((await core('/api/v1/core/transactions/monthly-summary', { 'x-wickermoney-plugin': 'wickermoney.insights' })).statusCode).toBe(200)
    expect((await core('/api/v1/core/transactions/monthly-summary', {})).statusCode).toBe(200)
  })

  it('serves spending-trends its monthly summary, and refuses it a table it did not ask for', async () => {
    const summary = await core('/api/v1/core/transactions/monthly-summary', {
      'x-wickermoney-plugin': 'wickermoney.spending-trends',
    })
    expect(summary.statusCode).toBe(200)

    const accounts = await core('/api/v1/core/accounts/list', { 'x-wickermoney-plugin': 'wickermoney.spending-trends' })
    expect(accounts.statusCode).toBe(403)
    expect(accounts.json().message).toContain("did not request read access to 'accounts'")
  })

  it('does not let one enabled plugin borrow another plugin grants', async () => {
    const res = await core('/api/v1/core/accounts/list', { 'x-wickermoney-plugin': 'wickermoney.insights' })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toContain("did not request read access to 'accounts'")
  })
})

describe('a disabled plugin', () => {
  it('has its server routes answer 404 plugin_disabled', async () => {
    const res = await h.app.inject({
      method: 'GET', url: `/api/v1/p/${DISABLED}/month?month=2026-03`,
      headers: { ...auth(user), 'x-wickermoney-plugin': DISABLED },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('plugin_disabled')
  })

  it('is left out of the plugin list', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/plugins', headers: auth(user) })
    const ids = (res.json() as { plugins: Array<{ id: string }> }).plugins.map((p) => p.id)
    expect(ids).not.toContain(DISABLED)
    expect(ids).toContain('wickermoney.insights')
  })
})
