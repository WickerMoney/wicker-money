import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KyselyUnitOfWork } from '../data/KyselyUnitOfWork.js'
import { asUser } from '../db/client.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { ReportService } from './service/ReportService.js'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('../plugins/registry.js')
  await seedBundledPlugins(h.db)
})
afterAll(async () => { await h.close() })

/** Fixed clock so month windows do not depend on when the suite runs. */
function serviceAt(iso: string): ReportService {
  return new ReportService(new KyselyUnitOfWork(h.db), () => new Date(iso))
}

async function post(u: TestUser, url: string, payload: Record<string, unknown>): Promise<{ id: string }> {
  const res = await h.app.inject({ method: 'POST', url, headers: auth(u), payload })
  if (res.statusCode !== 201) throw new Error(`${url} failed: ${res.statusCode} ${res.body}`)
  return res.json() as { id: string }
}

async function ledgerFor(u: TestUser) {
  const account = await post(u, '/api/v1/accounts', { name: 'Main', accountType: 'checking' })
  const groceries = await post(u, '/api/v1/categories', { name: 'Groceries', slug: 'groceries' })
  const dining = await post(u, '/api/v1/categories', { name: 'Dining', slug: 'dining' })
  const spend = (amount: string, transactionDate: string, categoryId?: string) =>
    post(u, '/api/v1/transactions', {
      accountId: account.id, amount, merchant: 'Shop', transactionDate,
      ...(categoryId === undefined ? {} : { categoryId }),
    })
  return { account, groceries, dining, spend }
}

describe('monthly summary and split transactions', () => {
  it('attributes each split to its own category instead of the parent', async () => {
    const u = await createUser(h)
    const { groceries, dining, spend } = await ledgerFor(u)

    const parent = await spend('-90.00', '2026-03-10', groceries.id)
    const put = await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${parent.id}/splits`, headers: auth(u),
      payload: { splits: [
        { amount: '-60.00', categoryId: groceries.id },
        { amount: '-30.00', categoryId: dining.id },
      ] },
    })
    expect(put.statusCode).toBe(200)
    await spend('-10.00', '2026-03-11')

    const { rows } = await serviceAt('2026-03-15T12:00:00Z').monthlySummary(u.id, 1)
    const byName = Object.fromEntries(rows.map((r) => [r.categoryName, r.total]))

    // 90 filed under the parent would read Groceries 90 and Dining 0.
    expect(byName).toEqual({ Groceries: '60.0000', Dining: '30.0000', Uncategorized: '10.0000' })
    const total = rows.reduce((sum, r) => sum + Number(r.total), 0)
    expect(total).toBe(100)
  })

  it('still reports refunds as negative spending and income as its own series', async () => {
    const u = await createUser(h)
    const { groceries, spend } = await ledgerFor(u)
    await spend('-40.00', '2026-03-02', groceries.id)
    await spend('15.00', '2026-03-03', groceries.id)
    await spend('500.00', '2026-03-04')

    const { rows } = await serviceAt('2026-03-15T12:00:00Z').monthlySummary(u.id, 1)
    expect(rows).toContainEqual(expect.objectContaining({ categoryName: 'Groceries', kind: 'expense', total: '25.0000' }))
    expect(rows).toContainEqual(expect.objectContaining({ categoryName: 'Uncategorized', kind: 'income', total: '500.0000' }))
  })

  it('serves the same shape over HTTP', async () => {
    const u = await createUser(h)
    const { groceries, dining, spend } = await ledgerFor(u)
    const today = new Date().toISOString().slice(0, 10)
    const parent = await spend('-50.00', today, groceries.id)
    await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${parent.id}/splits`, headers: auth(u),
      payload: { splits: [
        { amount: '-20.00', categoryId: groceries.id },
        { amount: '-30.00', categoryId: dining.id },
      ] },
    })

    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=1',
      headers: { ...auth(u), 'x-wickermoney-plugin': 'wickermoney.insights' },
    })
    const body = res.json() as { months: number; rows: Array<{ categoryName: string; total: string; categoryId: string }> }
    expect(body.months).toBe(1)
    expect(Object.fromEntries(body.rows.map((r) => [r.categoryName, r.total])))
      .toEqual({ Groceries: '20.0000', Dining: '30.0000' })
    expect(body.rows.find((r) => r.categoryName === 'Dining')?.categoryId).toBe(dining.id)
  })
})

describe('monthly summary and the user time zone', () => {
  it("decides which month is current from the user's own clock", async () => {
    const u = await createUser(h)
    const { spend } = await ledgerFor(u)
    await spend('-15.00', '2026-02-20')

    // 03:00 UTC on 1 March is still the evening of 28 February in New York.
    const instant = '2026-03-01T03:00:00Z'

    await asUser(h.db, u.id, (trx) =>
      trx.updateTable('core.users').set({ timezone: 'UTC' }).where('id', '=', u.id).execute())
    const utc = await serviceAt(instant).monthlySummary(u.id, 1)
    expect(utc.rows).toEqual([])

    await asUser(h.db, u.id, (trx) =>
      trx.updateTable('core.users').set({ timezone: 'America/New_York' }).where('id', '=', u.id).execute())
    const newYork = await serviceAt(instant).monthlySummary(u.id, 1)
    expect(newYork.rows).toEqual([
      expect.objectContaining({ month: '2026-02', kind: 'expense', total: '15.0000' }),
    ])
  })
})
