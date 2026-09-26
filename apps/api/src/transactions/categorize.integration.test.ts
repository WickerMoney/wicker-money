import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { asUser } from '../db/client.js'

let h: Harness
let user: TestUser
let other: TestUser
let accountId: string
let groceries: string
let dining: string

async function post<T = unknown>(url: string, payload: unknown, u = user): Promise<T> {
  const res = await h.app.inject({ method: 'POST', url, headers: auth(u), payload })
  return res.json() as T
}

async function newTransaction(merchant: string, amount = '-10.00'): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(user),
    payload: { accountId, merchant, amount, transactionDate: '2026-03-04' },
  })
  return (res.json() as { id: string }).id
}

async function readRow(id: string) {
  return asUser(h.db, user.id, async (trx) => {
    const r = await sql<{ category_id: string | null; category_source: string | null }>`
      SELECT category_id, category_source::text FROM core.transactions WHERE id = ${id}
    `.execute(trx)
    return r.rows[0]
  })
}

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  other = await createUser(h)

  const acc = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name: 'Everyday', accountType: 'checking', openingBalance: '0.00' },
  })
  accountId = (acc.json() as { id: string }).id

  groceries = (await post<{ id: string }>('/api/v1/categories', { name: 'Groceries', slug: 'groceries' })).id
  dining = (await post<{ id: string }>('/api/v1/categories', { name: 'Dining', slug: 'dining' })).id
})
afterAll(async () => { await h.close() })

describe('the uncategorized filter', () => {
  it('lists only transactions with no category', async () => {
    const bare = await newTransaction('UNKNOWN SHOP')
    await post('/api/v1/transactions/categorize', { transactionIds: [await newTransaction('FILED SHOP')], categoryId: groceries })

    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/transactions?uncategorized=true&limit=100', headers: auth(user),
    })
    const items = (res.json() as { items: Array<{ id: string; category_id: string | null }> }).items

    expect(items.some((t) => t.id === bare)).toBe(true)
    expect(items.every((t) => t.category_id === null)).toBe(true)
  })
})

describe('bulk categorize', () => {
  it('assigns many at once and marks them manual', async () => {
    const ids = [await newTransaction('A'), await newTransaction('B'), await newTransaction('C')]

    const r = await post<{ updated: number }>('/api/v1/transactions/categorize', {
      transactionIds: ids, categoryId: dining,
    })

    expect(r.updated).toBe(3)
    for (const id of ids) {
      // 'manual' is what protects these from a later rule sweep. A bulk
      // assignment is still a person deciding, so it must not be recorded as
      // anything weaker.
      expect(await readRow(id)).toEqual({ category_id: dining, category_source: 'manual' })
    }
  })

  it('clears a category when given null, leaving no dangling source', async () => {
    const id = await newTransaction('TO CLEAR')
    await post('/api/v1/transactions/categorize', { transactionIds: [id], categoryId: groceries })

    await post('/api/v1/transactions/categorize', { transactionIds: [id], categoryId: null })

    // The check constraint requires category and source to be set together, so
    // a half-cleared row cannot exist.
    expect(await readRow(id)).toEqual({ category_id: null, category_source: null })
  })

  it('silently updates nothing for another user\'s transactions', async () => {
    const mine = await newTransaction('MINE')
    const theirs = (await post<{ id: string }>('/api/v1/categories', { name: 'Theirs', slug: 'theirs' }, other)).id

    const r = await post<{ updated: number; requested: number; skippedTransfers: number }>(
      '/api/v1/transactions/categorize',
      { transactionIds: [mine], categoryId: theirs },
      other,
    )

    // Row-level security hides the row from the other user, so the update
    // matches nothing. Reporting both numbers is what makes that visible rather
    // than looking like success.
    expect(r).toEqual({ updated: 0, requested: 1, skippedTransfers: 0 })
    expect((await readRow(mine))?.category_id).toBeNull()
  })

  it('refuses an empty or oversized batch', async () => {
    const empty = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/categorize', headers: auth(user),
      payload: { transactionIds: [], categoryId: dining },
    })
    expect(empty.statusCode).toBe(400)
  })
})

describe('rules and manual assignments together (Q13)', () => {
  it('leaves a hand-set category alone when a rule is applied to existing rows', async () => {
    const byHand = await newTransaction('COFFEE BAR DOWNTOWN')
    await post('/api/v1/transactions/categorize', { transactionIds: [byHand], categoryId: dining })

    const byNothing = await newTransaction('COFFEE BAR UPTOWN')

    await post('/api/v1/category-rules', {
      categoryId: groceries,
      priority: 5,
      applyToExisting: true,
      conditions: [{ conditionType: 'merchant_contains', textValue: 'COFFEE BAR' }],
    })

    // The rule matched both merchants. It may claim the untouched one and must
    // not touch the one a person filed — that asymmetry is the whole point of protecting manual assignments.
    expect((await readRow(byHand))?.category_id).toBe(dining)
    expect((await readRow(byNothing))?.category_id).toBe(groceries)
  })
})

describe('category uniqueness', () => {
  it('refuses a second category with the same name', async () => {
    await post('/api/v1/categories', { name: 'Utilities', slug: 'utilities' })

    const again = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Utilities', slug: 'utilities' },
    })

    // The unique index already prevents the duplicate; this pins that the
    // violation surfaces as a readable 409 rather than a 500.
    expect(again.statusCode).toBe(409)
    expect((again.json() as { code: string }).code).toBe('category_exists')
  })

  it('treats case as the same category', async () => {
    await post('/api/v1/categories', { name: 'Travel', slug: 'travel' })
    // The index is on the raw slug, so without normalising the input this
    // would succeed and leave two Travel categories.
    const shouty = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'TRAVEL', slug: 'TRAVEL' },
    })
    expect(shouty.statusCode).toBe(409)
  })

  it('leaves another user free to use the same name', async () => {
    const theirs = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(other),
      payload: { name: 'Utilities', slug: 'utilities' },
    })
    expect(theirs.statusCode).toBe(201)
  })
})
