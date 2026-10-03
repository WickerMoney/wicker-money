import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

let h: Harness
let user: TestUser

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  // Bundled plugins register at boot; the harness builds the app directly, so
  // seed explicitly here.
  const { seedBundledPlugins } = await import('./registry.js')
  await seedBundledPlugins(h.db)
})
afterAll(async () => { await h.close() })

const asPlugin = (u: TestUser, id: string) => ({ ...auth(u), 'x-wickermoney-plugin': id })

describe('plugin registry endpoint', () => {
  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/plugins' })
    expect(res.statusCode).toBe(401)
  })

  it('lists the bundled insights plugin with its grants', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/plugins', headers: auth(user) })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { plugins: Array<{ id: string; bundled: boolean; requiredTables: unknown[] }> }
    const insights = body.plugins.find((p) => p.id === 'wickermoney.insights')
    expect(insights).toBeDefined()
    expect(insights?.bundled).toBe(true)
    expect(insights?.requiredTables).toEqual([
      { table: 'transactions', access: 'read' },
      { table: 'categories', access: 'read' },
    ])
  })

  it('lists the bundled spending-trends plugin with read-only grants and no accounts', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/plugins', headers: auth(user) })
    const body = res.json() as { plugins: Array<{ id: string; bundled: boolean; requiredTables: unknown[] }> }
    const trends = body.plugins.find((p) => p.id === 'wickermoney.spending-trends')
    expect(trends?.bundled).toBe(true)
    expect(trends?.requiredTables).toEqual([
      { table: 'transactions', access: 'read' },
      { table: 'categories', access: 'read' },
    ])
  })
})

/**
 * These are the load-bearing tests of the permission model. If a plugin can read a table it
 * never asked for, requiredTables is documentation rather than a control.
 */
describe('requiredTables enforcement', () => {
  it('allows a granted table', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/core/transactions/monthly-summary',
      headers: asPlugin(user, 'wickermoney.insights'),
    })
    expect(res.statusCode).toBe(200)
  })

  it('REFUSES a table the manifest does not grant', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/core/accounts/summary',
      headers: asPlugin(user, 'wickermoney.insights'),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('grant_denied')
    expect(res.json().message).toContain("did not request read access to 'accounts'")
  })

  it('refuses an unknown plugin identity outright', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/core/transactions/monthly-summary',
      headers: asPlugin(user, 'evil.plugin'),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toContain('not installed')
  })

  it('still requires authentication even with a valid plugin identity', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/core/transactions/monthly-summary',
      headers: { 'x-wickermoney-plugin': 'wickermoney.insights' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('lets the host itself through — no plugin identity, still user-scoped', async () => {
    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/accounts/summary', headers: auth(user),
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('monthly summary', () => {
  // The summary asks the clock which month is current, and `months=1` covers
  // only that month. Fixing the date to the middle of the real current month
  // makes the transactions below and the server agree on "today" however close
  // to a month boundary the suite happens to run. Only `Date` is faked. Each
  // test calls this before it creates users, so their access tokens are issued
  // and checked on the same (fake) clock. Calling it afterwards made every
  // token look expired whenever the real date was before the 15th.
  const fixClockMidMonth = (): void => {
    const real = new Date()
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date(Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), 15, 12)),
    })
  }
  afterEach(() => { vi.useRealTimers() })

  it('aggregates expenses by month and category, excluding transfers', async () => {
    fixClockMidMonth()
    const u = await createUser(h)
    const acc = (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Main', accountType: 'checking' },
    })).json()
    const other = (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Savings', accountType: 'savings' },
    })).json()
    const cat = (await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(u),
      payload: { name: 'Groceries', slug: 'groceries' },
    })).json()

    const today = new Date().toISOString().slice(0, 10)
    for (const amount of ['-20.00', '-30.00']) {
      await h.app.inject({
        method: 'POST', url: '/api/v1/transactions', headers: auth(u),
        payload: { accountId: acc.id, amount, merchant: 'Shop', transactionDate: today, categoryId: cat.id },
      })
    }
    // Income and transfers must not appear as spending.
    await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(u),
      payload: { accountId: acc.id, amount: '500.00', merchant: 'Salary', transactionDate: today },
    })
    // Through the transfer endpoint, because a transfer is two rows and the
    // plain create path now refuses to write half of one.
    await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(u),
      payload: {
        fromAccountId: acc.id, toAccountId: other.id,
        amount: '100.00', transactionDate: today,
      },
    })

    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1',
      headers: asPlugin(u, 'wickermoney.insights'),
    })
    const body = res.json() as {
      rows: Array<{ categoryName: string; kind: string; total: string }>
    }

    const expense = body.rows.filter((r) => r.kind === 'expense')
    expect(expense).toHaveLength(1)
    expect(expense[0]?.categoryName).toBe('Groceries')
    expect(expense[0]?.total).toBe('50.0000')

    // Income is now returned as its own series rather than dropped, which is
    // what lets the chart show both directions. The transfer appears in
    // neither.
    const income = body.rows.filter((r) => r.kind === 'income')
    expect(income).toHaveLength(1)
    expect(income[0]?.total).toBe('500.0000')
    expect(body.rows.some((r) => r.categoryName === 'To savings')).toBe(false)
  })

  it('is scoped to the caller — one user never sees another', async () => {
    fixClockMidMonth()
    const alice = await createUser(h)
    const bob = await createUser(h)
    const acc = (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(alice),
      payload: { name: 'Alice', accountType: 'checking' },
    })).json()
    await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(alice),
      payload: {
        accountId: acc.id, amount: '-77.00', merchant: 'Alice only',
        transactionDate: new Date().toISOString().slice(0, 10),
      },
    })

    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1',
      headers: asPlugin(bob, 'wickermoney.insights'),
    })
    expect((res.json() as { rows: unknown[] }).rows).toHaveLength(0)
  })
})
