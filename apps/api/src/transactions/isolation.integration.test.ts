import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

let h: Harness
let user: TestUser
let other: TestUser
let myAccount: string
let theirAccount: string
let myCategory: string
let theirCategory: string
let theirTransaction: string
let theirLeg: string

const MISSING = '00000000-0000-4000-8000-000000000000'

async function create(path: string, u: TestUser, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await h.app.inject({ method: 'POST', url: path, headers: auth(u), payload })
  if (res.statusCode !== 201) throw new Error(`${path} failed: ${res.statusCode} ${res.body}`)
  return res.json() as Record<string, unknown>
}

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  other = await createUser(h)
  myAccount = (await create('/api/v1/accounts', user, { name: 'Mine', accountType: 'checking', initialBalance: '0' }))['id'] as string
  theirAccount = (await create('/api/v1/accounts', other, { name: 'Theirs', accountType: 'checking', initialBalance: '0' }))['id'] as string
  const theirSavings = (await create('/api/v1/accounts', other, { name: 'Their savings', accountType: 'savings', initialBalance: '0' }))['id'] as string
  myCategory = (await create('/api/v1/categories', user, { name: 'Mine', slug: 'mine' }))['id'] as string
  theirCategory = (await create('/api/v1/categories', other, { name: 'Theirs', slug: 'theirs' }))['id'] as string
  theirTransaction = (await create('/api/v1/transactions', other, {
    accountId: theirAccount, amount: '-10.00', merchant: 'Secret', transactionDate: '2026-05-01',
  }))['id'] as string
  const transfer = await create('/api/v1/transactions/transfer', other, {
    fromAccountId: theirAccount, toAccountId: theirSavings, amount: '5.00', transactionDate: '2026-05-01',
  })
  theirLeg = (transfer['legs'] as Array<{ id: string }>)[0]?.id ?? ''
})
afterAll(async () => { await h.close() })

interface Route { readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; readonly path: (id: string) => string; readonly payload?: unknown }

const validSplits = { splits: [{ amount: '-6.00' }, { amount: '-4.00' }] }

const idRoutes: Record<string, Route> = {
  'PATCH /transactions/:id': { method: 'PATCH', path: (id) => `/api/v1/transactions/${id}`, payload: { merchant: 'Hijacked' } },
  'DELETE /transactions/:id': { method: 'DELETE', path: (id) => `/api/v1/transactions/${id}` },
  'GET /transactions/:id/splits': { method: 'GET', path: (id) => `/api/v1/transactions/${id}/splits` },
  'PUT /transactions/:id/splits': { method: 'PUT', path: (id) => `/api/v1/transactions/${id}/splits`, payload: validSplits },
  'DELETE /transactions/:id/splits': { method: 'DELETE', path: (id) => `/api/v1/transactions/${id}/splits` },
}

const bodyRoutes: Record<string, Route> = {
  'GET /transactions': { method: 'GET', path: () => '/api/v1/transactions' },
  'POST /transactions': { method: 'POST', path: () => '/api/v1/transactions', payload: {} },
  'POST /transactions/transfer': { method: 'POST', path: () => '/api/v1/transactions/transfer', payload: {} },
  'POST /transactions/categorize': { method: 'POST', path: () => '/api/v1/transactions/categorize', payload: {} },
}

describe('authentication', () => {
  it.each([...Object.entries(idRoutes), ...Object.entries(bodyRoutes)])('%s answers 401 without a token', async (_name, route) => {
    const res = await h.app.inject({ method: route.method, url: route.path(MISSING), payload: route.payload as object | undefined })
    expect(res.statusCode).toBe(401)
  })
})

describe("another user's transaction ids", () => {
  it.each(Object.entries(idRoutes))('%s answers 404 for a foreign transaction, a foreign transfer leg and an unknown id', async (_name, route) => {
    for (const id of [theirTransaction, theirLeg, MISSING]) {
      const res = await h.app.inject({ method: route.method, url: route.path(id), headers: auth(user), payload: route.payload as object | undefined })
      expect(res.statusCode, `${route.method} ${route.path(id)}`).toBe(404)
      expect(res.json()).toMatchObject({ code: 'not_found' })
    }
  })

  it.each(Object.entries(idRoutes))('%s answers 400 for an id that is not a UUID', async (_name, route) => {
    const res = await h.app.inject({ method: route.method, url: route.path('not-a-uuid'), headers: auth(user), payload: route.payload as object | undefined })
    expect(res.statusCode).toBe(400)
  })

  it('never changed the foreign rows', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/transactions?limit=200', headers: auth(other) })
    const items = (res.json() as { items: Array<{ id: string; merchant: string; is_split: boolean }> }).items
    expect(items.find((t) => t.id === theirTransaction)).toMatchObject({ merchant: 'Secret', is_split: false })
    expect(items.some((t) => t.id === theirLeg)).toBe(true)
  })

  it('leaves them out of the listing and out of a bulk categorize', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/transactions?withTotal=true', headers: auth(user) })
    expect(list.json()).toMatchObject({ total: 0, items: [], nextCursor: null })

    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/categorize', headers: auth(user),
      payload: { transactionIds: [theirTransaction, theirLeg], categoryId: myCategory },
    })
    // The transfer leg is not visible to this user either, so nothing counts as skipped.
    expect(res.json()).toEqual({ updated: 0, requested: 2, skippedTransfers: 0 })
  })
})

describe('creating with references that are not yours', () => {
  const base = { amount: '-5.00', merchant: 'Cafe', transactionDate: '2026-05-03' }
  const post = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/transactions', headers: auth(user), payload })

  it("answers 404 for another user's account and for an unknown one, never 500", async () => {
    expect((await post({ ...base, accountId: theirAccount })).statusCode).toBe(404)
    expect((await post({ ...base, accountId: MISSING })).statusCode).toBe(404)
  })

  it("answers 400 for another user's or an unknown category", async () => {
    expect((await post({ ...base, accountId: myAccount, categoryId: theirCategory })).statusCode).toBe(400)
    expect((await post({ ...base, accountId: myAccount, categoryId: MISSING })).statusCode).toBe(400)
  })

  it('writes nothing when a reference is refused', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/transactions?withTotal=true', headers: auth(user) })
    expect((list.json() as { total: number }).total).toBe(0)
  })

  it('refuses a foreign or unknown category on edit and on bulk categorize with 400', async () => {
    const mine = (await create('/api/v1/transactions', user, { ...base, accountId: myAccount }))['id'] as string
    const edit = await h.app.inject({ method: 'PATCH', url: `/api/v1/transactions/${mine}`, headers: auth(user), payload: { categoryId: theirCategory } })
    expect(edit.statusCode).toBe(400)
    const bulk = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/categorize', headers: auth(user),
      payload: { transactionIds: [mine], categoryId: MISSING },
    })
    expect(bulk.statusCode).toBe(400)
  })

  it('answers 404 for a transfer touching an account that is not yours', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(user),
      payload: { fromAccountId: myAccount, toAccountId: MISSING, amount: '1.00', transactionDate: '2026-05-03' },
    })
    expect(res.statusCode).toBe(404)
  })
})
