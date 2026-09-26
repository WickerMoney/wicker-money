import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

let h: Harness
let user: TestUser
let other: TestUser
let checking: string
let savings: string
let food: string
let groceries: string

interface Row {
  id: string
  merchant: string
  amount: string
  transaction_date: string
  account_id: string
  category_id: string | null
}

interface Page {
  items: Row[]
  nextCursor: string | null
  total?: number
}

/** Three dates for 47 rows, so every page boundary lands inside a run of equal dates. */
const DATES = ['2026-04-01', '2026-04-02', '2026-04-03']
const MERCHANTS = ['apple', 'Apple', 'banana', 'Banana', 'cherry', 'Cherry', 'date', 'Date']
const ROW_COUNT = 47

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  other = await createUser(h)

  const post = async (who: TestUser, url: string, payload: Record<string, unknown>) =>
    (await h.app.inject({ method: 'POST', url, headers: auth(who), payload })).json() as { id: string }
  checking = (await post(user, '/api/v1/accounts', { name: 'Checking', accountType: 'checking' })).id
  savings = (await post(user, '/api/v1/accounts', { name: 'Savings', accountType: 'savings' })).id
  food = (await post(user, '/api/v1/categories', { name: 'Food', slug: 'food' })).id
  groceries = (await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(user),
    payload: { name: 'Groceries', slug: 'groceries-shop', parentId: food },
  })).json().id

  for (let i = 0; i < ROW_COUNT; i += 1) {
    await post(user, '/api/v1/transactions', {
      accountId: i % 2 === 0 ? checking : savings,
      amount: `-${(i % 7) + 1}.50`,
      merchant: MERCHANTS[i % MERCHANTS.length]!,
      transactionDate: DATES[i % DATES.length]!,
      ...(i % 5 === 0 ? { categoryId: groceries } : {}),
    })
  }
  const otherAccount = await post(other, '/api/v1/accounts', { name: 'Theirs', accountType: 'checking' })
  await post(other, '/api/v1/transactions', {
    accountId: otherAccount.id, amount: '-1.00', merchant: 'apple', transactionDate: DATES[0]!,
  })
})
afterAll(async () => { await h.close() })

const get = async (query: string, who: TestUser = user): Promise<Page> => {
  const res = await h.app.inject({ method: 'GET', url: `/api/v1/transactions?${query}`, headers: auth(who) })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as Page
}

/** Follows `nextCursor` to the end, returning every page. */
async function walk(query: string, limit = 10, startAfter: string | null = null): Promise<Page[]> {
  const pages: Page[] = []
  let cursor: string | null = startAfter
  do {
    const page: Page = await get(`${query}&limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`)
    pages.push(page)
    cursor = page.nextCursor
  } while (cursor !== null && pages.length < 100)
  return pages
}

const idsOf = (pages: Page[]): string[] => pages.flatMap((p) => p.items.map((t) => t.id))

describe('cursor paging', () => {
  it.each([
    ['date', 'desc'], ['date', 'asc'],
    ['amount', 'desc'], ['amount', 'asc'],
    ['merchant', 'desc'], ['merchant', 'asc'],
  ] as const)('visits every row exactly once, in the database order, sorting by %s %s', async (sort, direction) => {
    const query = `sort=${sort}&direction=${direction}`

    const pages = await walk(query)
    const single = await get(`${query}&limit=200`)

    expect(pages.map((p) => p.items.length)).toEqual([10, 10, 10, 10, 7])
    expect(pages.slice(0, -1).every((p) => p.nextCursor !== null)).toBe(true)
    expect(pages.at(-1)?.nextCursor).toBeNull()
    expect(single.nextCursor).toBeNull()
    expect(new Set(idsOf(pages)).size).toBe(ROW_COUNT)
    expect(idsOf(pages)).toEqual(single.items.map((t) => t.id))
  })

  it('orders by date, then by id in the same direction', async () => {
    const desc = (await get('sort=date&direction=desc&limit=200')).items
    const asc = (await get('sort=date&direction=asc&limit=200')).items

    const key = (t: Row) => `${t.transaction_date} ${t.id}`
    expect(desc.map(key)).toEqual(desc.map(key).sort().reverse())
    expect(asc.map(key)).toEqual(asc.map(key).sort())
  })

  it('orders amounts numerically', async () => {
    const amounts = (await get('sort=amount&direction=asc&limit=200')).items.map((t) => Number(t.amount))

    expect(amounts).toEqual([...amounts].sort((a, b) => a - b))
  })

  it('resumes correctly from a cursor made from a tied row at the start, middle and end of a run of equal keys', async () => {
    // Page sizes 1..12 put a boundary at every position within the runs of equal dates.
    const baseline = idsOf(await walk('sort=date&direction=desc', 200))
    for (let limit = 1; limit <= 12; limit += 1) {
      expect(idsOf(await walk('sort=date&direction=desc', limit)), `limit ${limit}`).toEqual(baseline)
    }
  })

  it('composes with every filter', async () => {
    const query = `accountId=${checking}&categoryId=${food}&from=2026-04-01&to=2026-04-02&search=APP&uncategorized=false`
    const single = await get(`${query}&limit=200&withTotal=true`)
    expect(single.items.length).toBeGreaterThan(1)

    const pages = await walk(query, 1)

    expect(idsOf(pages)).toEqual(single.items.map((t) => t.id))
    expect(single.total).toBe(single.items.length)
    expect(single.items.every((t) => t.account_id === checking && t.category_id === groceries)).toBe(true)
  })

  it('composes with the uncategorized filter', async () => {
    const pages = await walk('uncategorized=true&sort=amount&direction=asc', 7)

    const rows = pages.flatMap((p) => p.items)
    expect(rows.length).toBeGreaterThan(14)
    expect(rows.every((t) => t.category_id === null)).toBe(true)
    expect(new Set(rows.map((t) => t.id)).size).toBe(rows.length)
  })

  it('counts only when asked, and the count ignores the cursor', async () => {
    const first = await get('limit=10')
    const withTotal = await get(`limit=10&withTotal=true&cursor=${first.nextCursor}`)

    expect(first).not.toHaveProperty('total')
    expect(withTotal.total).toBe(ROW_COUNT)
  })

  it('does not list another user\'s rows', async () => {
    const theirs = await get('limit=200&withTotal=true', other)

    expect(theirs.total).toBe(1)
    expect(theirs.items).toHaveLength(1)
  })

  it('repeats no row and skips none when rows are inserted between pages', async () => {
    const before = idsOf(await walk('sort=date&direction=desc', 200))
    const first = await get('sort=date&direction=desc&limit=10')
    const second = await get(`sort=date&direction=desc&limit=10&cursor=${first.nextCursor}`)
    const cursorRow = second.items.at(-1)!

    // One row tied with the cursor row on date (its random id may sort either
    // side of the cursor's), one newer than everything and one older.
    const added: string[] = []
    for (const transactionDate of [cursorRow.transaction_date, '2026-12-31', '2026-01-01']) {
      const res = await h.app.inject({
        method: 'POST', url: '/api/v1/transactions', headers: auth(user),
        payload: { accountId: checking, amount: '-3.33', merchant: 'Late arrival', transactionDate },
      })
      added.push(res.json().id)
    }
    const rest = await walk('sort=date&direction=desc', 10, second.nextCursor)

    const seen = [...first.items, ...second.items, ...rest.flatMap((p) => p.items)].map((t) => t.id)
    expect(new Set(seen).size).toBe(seen.length)
    for (const id of before) expect(seen, id).toContain(id)
    // Behind the cursor, so never shown; the older row is still ahead and is.
    expect(seen).not.toContain(added[1])
    expect(seen).toContain(added[2])
    expect(rest.at(-1)?.nextCursor).toBeNull()
  })

  it('still resumes after the cursor row itself has been deleted', async () => {
    const created = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: { accountId: checking, amount: '-1.11', merchant: 'Doomed', transactionDate: '2026-04-02' },
    })
    const doomed = created.json().id as string
    const all = (await get('sort=date&direction=desc&limit=200')).items.map((t) => t.id)
    const position = all.indexOf(doomed)
    const upToDoomed = await get(`sort=date&direction=desc&limit=${position + 1}`)
    expect(upToDoomed.items.at(-1)?.id).toBe(doomed)

    await h.app.inject({ method: 'DELETE', url: `/api/v1/transactions/${doomed}`, headers: auth(user) })
    const rest = await walk('sort=date&direction=desc', 10, upToDoomed.nextCursor)

    expect(idsOf(rest)).toEqual(all.slice(position + 1))
  })
})
