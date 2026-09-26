import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

let h: Harness
let user: TestUser
let other: TestUser
let accountId: string
let groceries: string
let dining: string
let theirCategory: string

interface Split { id: string; amount: string; category_id: string | null }

async function create(path: string, u: TestUser, payload: Record<string, unknown>): Promise<{ id: string }> {
  const res = await h.app.inject({ method: 'POST', url: path, headers: auth(u), payload })
  if (res.statusCode !== 201) throw new Error(`${path} failed: ${res.statusCode} ${res.body}`)
  return res.json() as { id: string }
}

async function newTransaction(amount = '-100.00', u = user, account = accountId): Promise<string> {
  return (await create('/api/v1/transactions', u, {
    accountId: account, amount, merchant: 'Supermarket', transactionDate: '2026-05-01',
  })).id
}

const putSplits = (id: string, splits: unknown, u = user) =>
  h.app.inject({ method: 'PUT', url: `/api/v1/transactions/${id}/splits`, headers: auth(u), payload: { splits } })
const getSplits = (id: string, u = user) =>
  h.app.inject({ method: 'GET', url: `/api/v1/transactions/${id}/splits`, headers: auth(u) })
const deleteSplits = (id: string, u = user) =>
  h.app.inject({ method: 'DELETE', url: `/api/v1/transactions/${id}/splits`, headers: auth(u) })
const patch = (id: string, payload: Record<string, unknown>, u = user) =>
  h.app.inject({ method: 'PATCH', url: `/api/v1/transactions/${id}`, headers: auth(u), payload })

async function readTxn(id: string, u = user): Promise<{ id: string; amount: string; is_split: boolean }> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/transactions?limit=200', headers: auth(u) })
  const row = (res.json() as { items: Array<{ id: string; amount: string; is_split: boolean }> }).items.find((t) => t.id === id)
  if (row === undefined) throw new Error(`transaction ${id} not listed`)
  return row
}

const two = (a: string, b: string) => [
  { amount: a, categoryId: groceries },
  { amount: b, categoryId: dining },
]

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  other = await createUser(h)
  accountId = (await create('/api/v1/accounts', user, { name: 'Splits', accountType: 'checking', initialBalance: '0' })).id
  groceries = (await create('/api/v1/categories', user, { name: 'Groceries', slug: 'groceries' })).id
  dining = (await create('/api/v1/categories', user, { name: 'Dining', slug: 'dining' })).id
  theirCategory = (await create('/api/v1/categories', other, { name: 'Theirs', slug: 'theirs' })).id
})
afterAll(async () => { await h.close() })

describe('splitting a transaction', () => {
  it('stores parts that share the sign and sum to the parent, and sets is_split', async () => {
    const id = await newTransaction('-100.00')
    expect((await readTxn(id)).is_split).toBe(false)

    const res = await putSplits(id, two('-60.00', '-40.00'))
    expect(res.statusCode).toBe(200)
    expect((res.json() as Split[]).map((s) => s.amount)).toEqual(['-60.0000', '-40.0000'])
    expect((await readTxn(id)).is_split).toBe(true)
  })

  it('rejects mixed signs even when the total matches', async () => {
    const id = await newTransaction('-100.00')
    const res = await putSplits(id, two('-150.00', '50.00'))
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'validation_failed' })
    expect((await getSplits(id)).json()).toEqual([])
    expect((await readTxn(id)).is_split).toBe(false)
  })

  it('rejects a zero part and a total that is off by a cent', async () => {
    const id = await newTransaction('-100.00')
    expect((await putSplits(id, two('-100.00', '0.00'))).statusCode).toBe(400)
    expect((await putSplits(id, two('-60.00', '-39.99'))).statusCode).toBe(400)
  })

  it('handles a positive parent with positive parts', async () => {
    const id = await newTransaction('100.00')
    expect((await putSplits(id, two('70.00', '30.00'))).statusCode).toBe(200)
    expect((await putSplits(id, two('-70.00', '170.00'))).statusCode).toBe(400)
  })

  it('replaces the previous parts when put again', async () => {
    const id = await newTransaction('-100.00')
    const first = (await putSplits(id, two('-60.00', '-40.00'))).json() as Split[]
    const second = await putSplits(id, [
      { amount: '-25.00' }, { amount: '-25.00' }, { amount: '-50.00', categoryId: groceries },
    ])
    expect(second.statusCode).toBe(200)

    const listed = (await getSplits(id)).json() as Split[]
    expect(listed.map((s) => s.amount).sort()).toEqual(['-25.0000', '-25.0000', '-50.0000'])
    expect(listed.some((s) => first.some((f) => f.id === s.id))).toBe(false)
  })

  it('requires between two and one hundred parts', async () => {
    const id = await newTransaction('-100.00')
    expect((await putSplits(id, [{ amount: '-100.00' }])).statusCode).toBe(400)
    const many = Array.from({ length: 101 }, () => ({ amount: '-0.0100' }))
    expect((await putSplits(id, many)).statusCode).toBe(400)
    const notes = two('-60.00', '-40.00').map((s) => ({ ...s, notes: 'x'.repeat(1001) }))
    expect((await putSplits(id, notes)).statusCode).toBe(400)
  })

  it('refuses another user\'s category', async () => {
    const id = await newTransaction('-100.00')
    const res = await putSplits(id, [{ amount: '-60.00', categoryId: theirCategory }, { amount: '-40.00' }])
    expect(res.statusCode).toBe(400)
    expect((await getSplits(id)).json()).toEqual([])
  })

  it('refuses to split a transfer leg', async () => {
    const savings = (await create('/api/v1/accounts', user, { name: 'Savings', accountType: 'savings', initialBalance: '0' })).id
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(user),
      payload: { fromAccountId: accountId, toAccountId: savings, amount: '100.00', transactionDate: '2026-05-02' },
    })
    const leg = (res.json() as { legs: Array<{ id: string }> }).legs[0]
    if (leg === undefined) throw new Error('no legs')
    const split = await putSplits(leg.id, two('-60.00', '-40.00'))
    expect(split.statusCode).toBe(400)
    expect((await readTxn(leg.id)).is_split).toBe(false)
  })
})

describe('reading splits', () => {
  it('returns an empty list for an unsplit transaction of your own', async () => {
    const res = await getSplits(await newTransaction())
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('is a 404, not an empty 200, for another user\'s or an unknown transaction', async () => {
    const mine = await newTransaction()
    await putSplits(mine, two('-60.00', '-40.00'))
    expect((await getSplits(mine, other)).statusCode).toBe(404)
    expect((await getSplits('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
  })
})

describe('editing the amount of a split transaction', () => {
  it('is refused with a 409, leaving the parts and the amount untouched', async () => {
    const id = await newTransaction('-100.00')
    await putSplits(id, two('-60.00', '-40.00'))

    const res = await patch(id, { amount: '-90.00' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'split_amount_locked' })
    expect((await readTxn(id)).amount).toBe('-100.0000')
    expect((await getSplits(id)).json()).toHaveLength(2)
  })

  it('still allows other fields, and re-sending the same amount', async () => {
    const id = await newTransaction('-100.00')
    await putSplits(id, two('-60.00', '-40.00'))
    expect((await patch(id, { merchant: 'Renamed' })).statusCode).toBe(200)
    expect((await patch(id, { amount: '-100' })).statusCode).toBe(200)
  })

  it('is allowed again once the splits are removed', async () => {
    const id = await newTransaction('-100.00')
    await putSplits(id, two('-60.00', '-40.00'))

    expect((await deleteSplits(id)).statusCode).toBe(204)
    expect((await getSplits(id)).json()).toEqual([])
    expect((await readTxn(id)).is_split).toBe(false)
    expect((await patch(id, { amount: '-90.00' })).statusCode).toBe(200)
    expect((await deleteSplits(id)).statusCode).toBe(204)
  })

  it('never leaves parts that disagree with the amount when the two race', async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await newTransaction('-100.00')
      await Promise.all([patch(id, { amount: '-90.00' }), putSplits(id, two('-60.00', '-40.00'))])

      const parent = await readTxn(id)
      const parts = (await getSplits(id)).json() as Split[]
      const total = parts.reduce((sum, s) => sum + Number(s.amount), 0)
      if (parts.length > 0) {
        expect(parent.is_split).toBe(true)
        expect(total).toBe(Number(parent.amount))
      } else {
        expect(parent.is_split).toBe(false)
      }
    }
  })
})
