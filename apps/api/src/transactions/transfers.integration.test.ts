import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

let h: Harness
let user: TestUser
let other: TestUser
let checking: string
let savings: string
let theirAccount: string

const pluginHeaders = (u: TestUser, id: string) => ({ ...auth(u), 'x-wickermoney-plugin': id })

async function newAccount(name: string, u = user): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(u),
    // `initialBalance`, not `openingBalance` — the latter is silently ignored
    // by the zod schema and every account quietly starts at zero.
    payload: { name, accountType: 'checking', initialBalance: '1000.00' },
  })
  if (res.statusCode !== 201) throw new Error(`account failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

async function balances(u = user): Promise<Record<string, string>> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(u) })
  const rows = res.json() as Array<{ id: string; balance: string }>
  return Object.fromEntries(rows.map((r) => [r.id, r.balance]))
}

async function transfer(payload: Record<string, unknown>, u = user) {
  return h.app.inject({
    method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(u), payload,
  })
}

interface SummaryRow { month: string; categoryName: string; kind: string; total: string }

async function summary(u = user): Promise<SummaryRow[]> {
  const res = await h.app.inject({
    method: 'GET', url: '/api/v1/core/transactions/monthly-summary?months=36',
    headers: pluginHeaders(u, 'wickermoney.insights'),
  })
  return (res.json() as { rows: SummaryRow[] }).rows
}

const totalOf = (rows: SummaryRow[], kind: string): number =>
  rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.total), 0)

async function spend(
  categoryId: string | null, amount: string, date: string, accountId = checking,
): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(user),
    payload: { accountId, merchant: 'SHOP', amount, transactionDate: date, categoryId },
  })
  if (res.statusCode !== 201) throw new Error(`transaction failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

async function newCategory(
  name: string, slug: string, kind?: string,
): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(user),
    payload: { name, slug, ...(kind === undefined ? {} : { kind }) },
  })
  if (res.statusCode !== 201) throw new Error(`category failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('../plugins/registry.js')
  await seedBundledPlugins(h.db)
  user = await createUser(h)
  other = await createUser(h)
  checking = await newAccount('Checking')
  savings = await newAccount('Savings')
  theirAccount = await newAccount('Theirs', other)
})
afterAll(async () => { await h.close() })

describe('recording a transfer', () => {
  it('writes both legs and moves both balances', async () => {
    const before = await balances()

    const res = await transfer({
      fromAccountId: checking, toAccountId: savings,
      amount: '250.00', transactionDate: '2026-04-10',
    })

    expect(res.statusCode).toBe(201)
    const body = res.json() as { transferId: string; legs: Array<{ account_id: string; amount: string }> }
    expect(body.legs.length).toBe(2)

    const after = await balances()
    // The whole point. With a single row the money would leave checking and
    // arrive nowhere, because the balance query sums transactions per account
    // and there was only ever one row.
    expect(Number(after[checking])).toBe(Number(before[checking]) - 250)
    expect(Number(after[savings])).toBe(Number(before[savings]) + 250)
  })

  it('links the two legs under one transfer id', async () => {
    const res = await transfer({
      fromAccountId: checking, toAccountId: savings,
      amount: '10.00', transactionDate: '2026-04-11',
    })
    const body = res.json() as { transferId: string; legs: Array<{ transfer_id: string }> }
    expect(body.legs.every((l) => l.transfer_id === body.transferId)).toBe(true)
  })

  it('takes direction from the accounts, not the sign', async () => {
    // "Transfer -500 from savings" has two possible meanings and neither should
    // be guessed at.
    const res = await transfer({
      fromAccountId: checking, toAccountId: savings,
      amount: '-50.00', transactionDate: '2026-04-12',
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toContain('positive amount')
  })

  it('refuses a transfer to the same account', async () => {
    const res = await transfer({
      fromAccountId: checking, toAccountId: checking,
      amount: '25.00', transactionDate: '2026-04-13',
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses an account that is not yours', async () => {
    const res = await transfer({
      fromAccountId: checking, toAccountId: theirAccount,
      amount: '25.00', transactionDate: '2026-04-14',
    })
    // Row-level security hides the account, so it reads as absent rather than
    // forbidden — which is the right thing for this user to be told.
    expect(res.statusCode).toBe(404)
    // And nothing was half-written on the way to finding out.
    expect(Number((await balances(other))[theirAccount])).toBe(1000)
  })

  it('names each leg from the other account by default', async () => {
    const res = await transfer({
      fromAccountId: checking, toAccountId: savings,
      amount: '5.00', transactionDate: '2026-04-15',
    })
    const legs = (res.json() as { legs: Array<{ account_id: string; merchant: string }> }).legs
    expect(legs.find((l) => l.account_id === checking)?.merchant).toBe('Transfer to Savings')
    expect(legs.find((l) => l.account_id === savings)?.merchant).toBe('Transfer from Checking')
  })
})

describe('a transfer is neither income nor spending', () => {
  it('appears in neither series', async () => {
    const before = await summary()
    const beforeExpense = totalOf(before, 'expense')
    const beforeIncome = totalOf(before, 'income')

    await transfer({
      fromAccountId: checking, toAccountId: savings,
      amount: '400.00', transactionDate: '2026-05-04',
    })

    const after = await summary()
    // £400 left one account and arrived in another. Counting the outgoing leg
    // as spending would overstate the month by
    // the entire transfer.
    expect(totalOf(after, 'expense')).toBeCloseTo(beforeExpense, 2)
    expect(totalOf(after, 'income')).toBeCloseTo(beforeIncome, 2)
  })

  it('is excluded from budget spend too', async () => {
    const groceries = await newCategory('Groceries', 'groceries')
    await h.app.inject({
      method: 'PUT', url: '/api/v1/p/wickermoney.budgets/line',
      headers: pluginHeaders(user, 'wickermoney.budgets'),
      payload: { month: '2026-05', categoryId: groceries, planned: '100.0000', rollover: false },
    })
    await spend(groceries, '-40.00', '2026-05-06')

    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/p/wickermoney.budgets/month?month=2026-05&tz=UTC',
      headers: pluginHeaders(user, 'wickermoney.budgets'),
    })
    const line = (res.json() as { lines: Array<{ categoryId: string; spent: string }> }).lines
      .find((l) => l.categoryId === groceries)

    // The budgets query and the insights query classify through the same rule;
    // a transfer showing in one and not the other is how two views of one
    // ledger start disagreeing.
    expect(line?.spent).toBe('40.0000')
  })
})

describe('a category of kind transfer', () => {
  it('is excluded even with no counterparty recorded', async () => {
    const payment = await newCategory('Card payment', 'card-payment', 'transfer')
    const before = totalOf(await summary(), 'expense')

    await spend(payment, '-2000.00', '2026-06-03')

    // A credit-card payment typed in by hand is still money moving. Counted as
    // spending it double-counts every purchase already on that card.
    expect(totalOf(await summary(), 'expense')).toBeCloseTo(before, 2)
  })

  it('cascades to its children, so marking the parent is enough', async () => {
    const parent = await newCategory('Moving money', 'moving-money')
    const childRes = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'To brokerage', slug: 'to-brokerage', parentId: parent },
    })
    const child = (childRes.json() as { id: string }).id

    await h.app.inject({
      method: 'PATCH', url: `/api/v1/categories/${parent}`, headers: auth(user),
      payload: { kind: 'transfer' },
    })

    const before = totalOf(await summary(), 'expense')
    await spend(child, '-900.00', '2026-06-04')

    // Marking a "Transfers" parent and seeing no change because the children
    // were still expenses would make the setting look broken.
    expect(totalOf(await summary(), 'expense')).toBeCloseTo(before, 2)
  })
})

describe('income and expense', () => {
  it('reads a positive amount in an income category as income', async () => {
    const salary = await newCategory('Salary', 'salary', 'income')
    const before = await summary()

    await spend(salary, '3000.00', '2026-07-01')

    const after = await summary()
    expect(totalOf(after, 'income')).toBeCloseTo(totalOf(before, 'income') + 3000, 2)
    expect(totalOf(after, 'expense')).toBeCloseTo(totalOf(before, 'expense'), 2)
  })

  it('keeps a refund an expense, reducing the month rather than inflating income', async () => {
    const shoes = await newCategory('Shoes', 'shoes')
    await spend(shoes, '-80.00', '2026-08-02')
    const afterPurchase = totalOf(await summary(), 'expense')

    await spend(shoes, '30.00', '2026-08-09')

    const afterRefund = totalOf(await summary(), 'expense')
    // Sign alone would call the £30 income. It is money back on a purchase, so
    // it reduces what Shoes cost — which is the whole reason kind beats sign.
    expect(afterRefund).toBeCloseTo(afterPurchase - 30, 2)
    expect((await summary()).some((r) => r.categoryName === 'Shoes' && r.kind === 'income')).toBe(false)
  })

  it('falls back to the sign when there is no category at all', async () => {
    const before = await summary()
    await spend(null, '500.00', '2026-09-02')
    await spend(null, '-60.00', '2026-09-03')

    const after = await summary()
    // A fresh import is entirely uncategorized. A chart that showed nothing
    // until it had been triaged would be useless exactly when it is wanted.
    expect(totalOf(after, 'income')).toBeCloseTo(totalOf(before, 'income') + 500, 2)
    expect(totalOf(after, 'expense')).toBeCloseTo(totalOf(before, 'expense') + 60, 2)
  })
})

describe('deleting a transfer', () => {
  it('takes both legs, so money never half-disappears', async () => {
    const before = await balances()
    const res = await transfer({
      fromAccountId: checking, toAccountId: savings,
      amount: '75.00', transactionDate: '2026-10-05',
    })
    const legs = (res.json() as { legs: Array<{ id: string }> }).legs

    const del = await h.app.inject({
      method: 'DELETE', url: `/api/v1/transactions/${legs[0]?.id}`, headers: auth(user),
    })
    expect(del.statusCode).toBe(204)

    const after = await balances()
    // Deleting one leg and leaving the other is money that left one account and
    // arrived nowhere. Each
    // surviving row would be individually well-formed, so no constraint catches
    // it.
    expect(after[checking]).toBe(before[checking])
    expect(after[savings]).toBe(before[savings])
  })

  it('still deletes an ordinary transaction on its own', async () => {
    const id = await spend(null, '-12.00', '2026-10-06')
    const del = await h.app.inject({
      method: 'DELETE', url: `/api/v1/transactions/${id}`, headers: auth(user),
    })
    expect(del.statusCode).toBe(204)
  })
})

describe('filtering by a category group', () => {
  it('matches everything under a parent, not only what is filed on it', async () => {
    const food = await newCategory('Food', 'food')
    const groceriesRes = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Groceries shop', slug: 'groceries-shop', parentId: food },
    })
    const groceries = (groceriesRes.json() as { id: string }).id
    const takeoutRes = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Takeout food', slug: 'takeout-food', parentId: food },
    })
    const takeout = (takeoutRes.json() as { id: string }).id
    const unrelated = await newCategory('Fuel', 'fuel-cat')

    await spend(food, '-10.00', '2027-12-01')
    await spend(groceries, '-20.00', '2027-12-02')
    await spend(takeout, '-30.00', '2027-12-03')
    await spend(unrelated, '-40.00', '2027-12-04')

    const res = await h.app.inject({
      method: 'GET', headers: auth(user),
      url: `/api/v1/transactions?categoryId=${food}&from=2027-12-01&to=2027-12-31&limit=100&withTotal=true`,
    })
    const body = res.json() as { total: number; items: Array<{ category_id: string }> }

    // Picking "Food" and seeing only the one row filed directly against it is
    // the surprising reading, and makes the parent option nearly useless.
    expect(body.total).toBe(3)
    expect(new Set(body.items.map((t) => t.category_id))).toEqual(
      new Set([food, groceries, takeout]),
    )
  })

  it('leaves a child filter narrow', async () => {
    const cats = await h.app.inject({
      method: 'GET', url: '/api/v1/categories', headers: auth(user),
    })
    const groceries = (cats.json() as Array<{ id: string; slug: string }>)
      .find((c) => c.slug === 'groceries-shop')

    const res = await h.app.inject({
      method: 'GET', headers: auth(user),
      url: `/api/v1/transactions?categoryId=${groceries?.id}&from=2027-12-01&to=2027-12-31&limit=100&withTotal=true`,
    })

    // A leaf has no children, so this is unchanged behaviour — worth pinning,
    // because widening the parent case by accident widening every case is the
    // obvious way to get this wrong.
    expect((res.json() as { total: number }).total).toBe(1)
  })

  it('never reaches another user\'s categories through the subquery', async () => {
    const theirFood = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(other),
      payload: { name: 'Food', slug: 'food' },
    })
    const theirId = (theirFood.json() as { id: string }).id

    const res = await h.app.inject({
      method: 'GET', url: `/api/v1/transactions?categoryId=${theirId}&limit=100&withTotal=true`,
      headers: auth(user),
    })
    // Row-level security scopes the subquery as well as the outer query, so a
    // parent id belonging to someone else expands to nothing rather than to
    // their children.
    expect((res.json() as { total: number }).total).toBe(0)
  })
})

describe('editing a transfer', () => {
  async function newTransfer(amount = '100.00', date = '2026-10-01') {
    const res = await transfer({
      fromAccountId: checking, toAccountId: savings,
      amount, transactionDate: date,
    })
    const body = res.json() as { transferId: string; legs: Array<{ id: string; account_id: string; amount: string }> }
    const from = body.legs.find((l) => l.account_id === checking)
    const to = body.legs.find((l) => l.account_id === savings)
    if (from === undefined || to === undefined) throw new Error('transfer did not write both legs')
    return { transferId: body.transferId, fromLegId: from.id, toLegId: to.id }
  }

  async function patch(id: string, payload: Record<string, unknown>) {
    return h.app.inject({ method: 'PATCH', url: `/api/v1/transactions/${id}`, headers: auth(user), payload })
  }

  async function readTxn(id: string) {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/transactions?limit=200`, headers: auth(user) })
    const items = (res.json() as { items: Array<{ id: string; amount: string; transaction_date: string }> }).items
    const row = items.find((t) => t.id === id)
    if (row === undefined) throw new Error(`transaction ${id} not found in list`)
    return row
  }

  it('syncs an amount edit to the sibling leg as the negated value', async () => {
    const { fromLegId, toLegId } = await newTransfer('100.00', '2026-10-01')

    const res = await patch(fromLegId, { amount: '-175.00' })
    expect(res.statusCode).toBe(200)

    const from = await readTxn(fromLegId)
    const to = await readTxn(toLegId)
    expect(from.amount).toBe('-175.0000')
    // The pair must still sum to zero, whichever leg was edited.
    expect(to.amount).toBe('175.0000')
  })

  it('syncs a date edit to the sibling leg', async () => {
    const { fromLegId, toLegId } = await newTransfer('50.00', '2026-10-02')

    const res = await patch(toLegId, { transactionDate: '2026-10-15' })
    expect(res.statusCode).toBe(200)

    const from = await readTxn(fromLegId)
    const to = await readTxn(toLegId)
    expect(to.transaction_date).toBe('2026-10-15')
    expect(from.transaction_date).toBe('2026-10-15')
  })

  it('leaves merchant and notes independent per leg', async () => {
    const { fromLegId, toLegId } = await newTransfer('20.00', '2026-10-03')

    const res = await patch(fromLegId, { merchant: 'Moved to vacation fund', notes: 'earmarked' })
    expect(res.statusCode).toBe(200)

    const listRes = await h.app.inject({ method: 'GET', url: '/api/v1/transactions?limit=200', headers: auth(user) })
    const items = (listRes.json() as { items: Array<{ id: string; merchant: string; notes: string | null }> }).items
    const from = items.find((t) => t.id === fromLegId)
    const to = items.find((t) => t.id === toLegId)
    expect(from?.merchant).toBe('Moved to vacation fund')
    expect(from?.notes).toBe('earmarked')
    // The sibling keeps its own "Transfer from Checking" label untouched.
    expect(to?.merchant).toBe('Transfer from Checking')
    expect(to?.notes).toBeNull()
  })

  it('refuses to give a transfer leg a category', async () => {
    const groceries = await newCategory('Errand fund', 'errand-fund')
    const { fromLegId } = await newTransfer('30.00', '2026-10-04')

    const res = await patch(fromLegId, { categoryId: groceries })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toContain('no category')
  })

  it('still refuses to turn a transfer leg into something else via transferAccountId', async () => {
    const { fromLegId } = await newTransfer('10.00', '2026-10-05')
    const res = await patch(fromLegId, { transferAccountId: savings })
    expect(res.statusCode).toBe(400)
  })
})

describe('a transfer leg keeps its direction', () => {
  async function newTransfer(amount = '100.00', date = '2026-11-01') {
    const res = await transfer({ fromAccountId: checking, toAccountId: savings, amount, transactionDate: date })
    const body = res.json() as { legs: Array<{ id: string; account_id: string }> }
    const from = body.legs.find((l) => l.account_id === checking)
    const to = body.legs.find((l) => l.account_id === savings)
    if (from === undefined || to === undefined) throw new Error('transfer did not write both legs')
    return { fromLegId: from.id, toLegId: to.id }
  }

  const patch = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/transactions/${id}`, headers: auth(user), payload })

  async function amounts(...ids: string[]): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/transactions?limit=200', headers: auth(user) })
    const items = (res.json() as { items: Array<{ id: string; amount: string }> }).items
    return ids.map((id) => items.find((t) => t.id === id)?.amount ?? 'missing')
  }

  it('refuses to flip the sign of either leg, because that would reverse the whole transfer', async () => {
    const { fromLegId, toLegId } = await newTransfer('100.00')

    const flipOut = await patch(fromLegId, { amount: '100.00' })
    expect(flipOut.statusCode).toBe(400)
    expect(flipOut.json()).toMatchObject({ code: 'validation_failed' })
    expect((await patch(toLegId, { amount: '-100.00' })).statusCode).toBe(400)
    expect((await patch(fromLegId, { amount: '0' })).statusCode).toBe(400)

    expect(await amounts(fromLegId, toLegId)).toEqual(['-100.0000', '100.0000'])
  })

  it('still allows a new magnitude in the same direction, edited from either leg', async () => {
    const { fromLegId, toLegId } = await newTransfer('100.00')
    expect((await patch(toLegId, { amount: '40.00' })).statusCode).toBe(200)
    expect(await amounts(fromLegId, toLegId)).toEqual(['-40.0000', '40.0000'])
  })

  it('treats an empty edit as a no-op that succeeds', async () => {
    const { fromLegId, toLegId } = await newTransfer('100.00')
    expect((await patch(fromLegId, {})).statusCode).toBe(200)
    expect(await amounts(fromLegId, toLegId)).toEqual(['-100.0000', '100.0000'])
  })

  it('keeps the pair consistent when both legs are edited at the same time', async () => {
    const { fromLegId, toLegId } = await newTransfer('100.00')
    const edits = Array.from({ length: 8 }, (_, i) =>
      patch(i % 2 === 0 ? fromLegId : toLegId, { amount: i % 2 === 0 ? `-${i + 10}.00` : `${i + 10}.00` }),
    )
    const results = await Promise.all(edits)
    // Locking the legs in one fixed order means the edits queue rather than deadlock.
    expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(200))

    const [out, into] = await amounts(fromLegId, toLegId)
    expect(Number(out) + Number(into)).toBe(0)
  })
})

describe('bulk categorize and transfers', () => {
  async function legIds(): Promise<[string, string]> {
    const res = await transfer({ fromAccountId: checking, toAccountId: savings, amount: '12.00', transactionDate: '2026-11-05' })
    const legs = (res.json() as { legs: Array<{ id: string }> }).legs
    return [legs[0]?.id ?? '', legs[1]?.id ?? '']
  }

  const categorize = (transactionIds: string[], categoryId: string | null) =>
    h.app.inject({ method: 'POST', url: '/api/v1/transactions/categorize', headers: auth(user), payload: { transactionIds, categoryId } })

  async function rowOf(id: string) {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/transactions?limit=200', headers: auth(user) })
    return (res.json() as { items: Array<{ id: string; category_id: string | null; category_source: string | null }> }).items.find((t) => t.id === id)
  }

  it('categorizes ordinary rows in a mixed batch and skips the legs, reporting how many', async () => {
    const category = await newCategory('Mixed batch', 'mixed-batch')
    const ordinary = await spend(null, '-3.00', '2026-11-05')
    const [outLeg, inLeg] = await legIds()

    const res = await categorize([ordinary, outLeg, inLeg], category)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ updated: 1, requested: 3, skippedTransfers: 2 })
    expect((await rowOf(ordinary))?.category_id).toBe(category)
    expect((await rowOf(outLeg))?.category_id).toBeNull()
    expect((await rowOf(inLeg))?.category_source).toBeNull()
  })

  it('refuses a batch of nothing but legs, as editing one leg does', async () => {
    const category = await newCategory('Legs only', 'legs-only')
    const [outLeg, inLeg] = await legIds()
    const res = await categorize([outLeg, inLeg], category)
    expect(res.statusCode).toBe(400)
    expect((res.json() as { message: string }).message).toContain('no category')
    expect((await rowOf(outLeg))?.category_id).toBeNull()
    expect((await categorize([outLeg], null)).statusCode).toBe(400)
  })
})
