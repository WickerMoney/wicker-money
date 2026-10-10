import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { countStatements, type StatementCount } from '../testing/countStatements.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * How many SQL statements the recurring request paths send, at two sizes.
 *
 * Guards against a path growing a query per item or per transaction, and
 * against two halves of one request each reading the same data. The bounds
 * are on data statements (see {@link StatementCount}) and sit a little above
 * what is measured, so unrelated work does not trip them while a reintroduced
 * loop does: at the larger size a per-item query would add dozens.
 */

let h: Harness

/** `YYYY-MM-DD` plus whole days, on UTC midnight. */
function plusDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

interface Scenario {
  readonly user: TestUser
  readonly today: string
  /** A page of transaction ids: matched, suggested, dismissed and unrelated ones. */
  readonly page: readonly string[]
}

async function post(user: TestUser, url: string, payload: Record<string, unknown>) {
  const res = await h.app.inject({ method: 'POST', url, headers: auth(user), payload })
  expect(res.statusCode, `${url} ${res.body}`).toBeLessThan(300)
  return res.json() as { id: string }
}

/**
 * A user with one account, `items` monthly bills falling in the suggestion
 * window, and `transactions` transactions: the first `items` are near enough
 * to their bill to be suggested, the first of those is matched, the second
 * dismissed, and the rest are unrelated.
 */
async function seed(items: number, transactions: number): Promise<Scenario> {
  const user = await createUser(h)
  const { id: checking } = await post(user, '/api/v1/accounts', {
    name: 'Checking', accountType: 'checking', initialBalance: '100000.00',
  })
  const list = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
  const today = (list.json() as { today: string }).today

  const bills: { id: string; due: string; amount: number }[] = []
  for (let i = 0; i < items; i++) {
    const due = plusDays(today, -10 + (i % 14))
    const amount = 20 + i * 7
    const { id } = await post(user, '/api/v1/recurring-items', {
      name: `Bill ${i}`, kind: 'bill', frequency: 'monthly', seriesStartDate: due,
      legs: [{ accountId: checking, amount: `-${amount}.00` }],
    })
    bills.push({ id, due, amount })
  }
  const page: string[] = []
  for (let i = 0; i < transactions; i++) {
    const bill = bills[i]
    const { id } = await post(user, '/api/v1/transactions', {
      accountId: checking, merchant: `Shop ${i}`,
      ...(bill === undefined
        ? { amount: '-3.33', transactionDate: plusDays(today, -(i % 90)) }
        : { amount: `-${bill.amount}.00`, transactionDate: plusDays(bill.due, 1) }),
    })
    page.push(id)
  }
  const [first, second] = bills
  if (first !== undefined && page[0] !== undefined) {
    await post(user, `/api/v1/recurring-items/${first.id}/occurrences/${first.due}/matches`, { transactionId: page[0] })
  }
  if (second !== undefined && page[1] !== undefined) {
    await post(user, `/api/v1/recurring-items/${second.id}/occurrences/${second.due}/dismissals`, { transactionId: page[1] })
  }
  return { user, today, page: page.slice(0, 200) }
}

/** Sends one GET and returns its statements and body. */
async function measure(user: TestUser, url: string): Promise<{ statements: StatementCount; body: unknown }> {
  const { result, statements } = await countStatements(() => h.app.inject({ method: 'GET', url, headers: auth(user) }))
  expect(result.statusCode, result.body).toBe(200)
  return { statements, body: result.json() }
}

beforeAll(async () => {
  h = await createHarness()
})

afterAll(async () => {
  await h.close()
})

/** The sizes measured: items and transactions. */
const SIZES = [
  { items: 3, transactions: 6 },
  { items: 12, transactions: 40 },
] as const

/**
 * The most data statements each path may send. Measured at both sizes, then
 * rounded up by one so a change of no consequence does not fail the suite; a
 * query per item or per transaction, or a second read of data the request
 * already holds, would.
 */
const BOUNDS: Record<string, { url: (s: Scenario) => string; max: number }> = {
  'transaction-matches': {
    url: (s) => `/api/v1/recurring-items/transaction-matches?transactionIds=${s.page.join(',')}`,
    // describeAt and findSuggestions share one load of items, records, links and tracking starts.
    max: 14,
  },
  suggestions: { url: () => '/api/v1/recurring-items/suggestions', max: 12 },
  upcoming: { url: () => '/api/v1/core/recurring-items/upcoming', max: 11 },
  'recurring-items': { url: () => '/api/v1/recurring-items', max: 9 },
  occurrences: { url: () => '/api/v1/recurring-items/occurrences', max: 9 },
}

/** Data statements for each path, by size label. */
const measured = new Map<string, Map<string, number>>()

describe.each(SIZES)('statements per request with $items items and $transactions transactions', ({ items, transactions }) => {
  let s: Scenario
  beforeAll(async () => {
    s = await seed(items, transactions)
  })

  for (const [name, { url, max }] of Object.entries(BOUNDS)) {
    it(`keeps ${name} within ${max} data statements`, async () => {
      const { statements } = await measure(s.user, url(s))
      const label = `${items} items, ${transactions} transactions`
      measured.set(name, (measured.get(name) ?? new Map()).set(label, statements.data.length))
      if (process.env['STATEMENTS_VERBOSE'] !== undefined) {
        console.info(`STATEMENTS ${name} (${label}): data=${statements.data.length} all=${statements.all.length}`)
      }
      expect(statements.data.length).toBeLessThanOrEqual(max)
    })
  }
})

describe('statement counts', () => {
  it('do not grow with the number of items or transactions', () => {
    for (const [name, bySize] of measured) {
      expect(new Set(bySize.values()).size, `${name}: ${JSON.stringify([...bySize])}`).toBe(1)
    }
    expect(measured.size).toBe(Object.keys(BOUNDS).length)
  })
})
