import { addDays } from '@wickermoney/plugin-sdk/date'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { countStatements } from '../testing/countStatements.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * How many SQL statements, and database transactions, the matching writes
 * (`match`, `override`, `unmatch`) and the candidate list send, with the
 * responses they give. The first transaction of each request is the session
 * check; the second is the unit of work, in which today, the occurrence's
 * state and its state afterwards are read. The bounds below guard against
 * reading any of them twice.
 */

let h: Harness

interface Scenario {
  readonly user: TestUser
  readonly today: string
  readonly checking: string
  readonly savings: string
}

async function send(user: TestUser, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return h.app.inject({ method, url, headers: auth(user), ...(payload === undefined ? {} : { payload }) })
}

async function create(user: TestUser, url: string, payload: Record<string, unknown>) {
  const res = await send(user, 'POST', url, payload)
  expect(res.statusCode, `${url} ${res.body}`).toBe(201)
  return res.json() as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function household(): Promise<Scenario> {
  const user = await createUser(h)
  const checking = (await create(user, '/api/v1/accounts', { name: 'Checking', accountType: 'checking', initialBalance: '1000.00' })).id as string
  const savings = (await create(user, '/api/v1/accounts', { name: 'Savings', accountType: 'savings', initialBalance: '1000.00' })).id as string
  const list = await send(user, 'GET', '/api/v1/recurring-items')
  return { user, today: (list.json() as { today: string }).today, checking, savings }
}

const occurrenceUrl = (itemId: string, date: string) => `/api/v1/recurring-items/${itemId}/occurrences/${date}`

/** One request: its response, the data statements it sent and the transactions it opened. */
async function measure(user: TestUser, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>, label = url) {
  const { result, statements } = await countStatements(() => send(user, method, url, payload))
  const transactions = statements.all.filter((s) => /^\s*(begin|start transaction)\b/i.test(s)).length
  if (process.env['STATEMENTS_VERBOSE'] !== undefined) {
    console.info(`STATEMENTS ${label}: data=${statements.data.length} transactions=${transactions}`)
  }
  return { res: result, body: result.json() as Record<string, any>, data: statements.data.length, transactions } // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  h = await createHarness()
})

afterAll(async () => {
  await h.close()
})

describe('matching writes', () => {
  it('matches a transaction in one unit of work and reports the settled leg', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, 1)
    const bill = (await create(user, '/api/v1/recurring-items', {
      name: 'Water', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-30.00' }],
    })).id as string
    const paid = (await create(user, '/api/v1/transactions', { accountId: checking, amount: '-30.00', merchant: 'Utility', transactionDate: today })).id as string

    const m = await measure(user, 'POST', `${occurrenceUrl(bill, due)}/matches`, { transactionId: paid }, 'match')
    expect(m.res.statusCode, m.res.body).toBe(200)
    expect(m.body).toMatchObject({
      itemId: bill, nominalDate: due, status: 'cleared',
      legs: [{ accountId: checking, amount: '-30.0000', transaction: { id: paid, date: today, amount: '-30.0000' } }],
    })
    expect(m.transactions).toBe(2)
    expect(m.data).toBeLessThanOrEqual(MAX.match)

    // Matching the same transaction again changes nothing and answers the same.
    const again = await measure(user, 'POST', `${occurrenceUrl(bill, due)}/matches`, { transactionId: paid }, 'match (again)')
    expect(again.body).toEqual(m.body)
    expect(again.transactions).toBe(2)
    expect(again.data).toBeLessThanOrEqual(MAX.matchAgain)

    const u = await measure(user, 'DELETE', `${occurrenceUrl(bill, due)}/matches/${paid}`, undefined, 'unmatch')
    expect(u.res.statusCode, u.res.body).toBe(200)
    expect(u.body).toMatchObject({ itemId: bill, nominalDate: due, status: 'upcoming', legs: [{ transaction: null }] })
    expect(u.transactions).toBe(2)
    expect(u.data).toBeLessThanOrEqual(MAX.unmatch)
  })

  it('links and unlinks both rows of a transfer', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, 1)
    const save = (await create(user, '/api/v1/recurring-items', {
      name: 'Save', kind: 'transfer', frequency: 'monthly', seriesStartDate: due,
      legs: [{ accountId: checking, amount: '-100.00' }, { accountId: savings, amount: '100.00' }],
    })).id as string
    const transfer = await create(user, '/api/v1/transactions/transfer', {
      fromAccountId: checking, toAccountId: savings, amount: '100.00', transactionDate: today,
    })
    const legs = transfer['legs'] as { id: string; account_id: string }[]
    const into = legs.find((l) => l.account_id === savings)?.id as string
    const out = legs.find((l) => l.account_id === checking)?.id as string

    const m = await measure(user, 'POST', `${occurrenceUrl(save, due)}/matches`, { transactionId: into }, 'match (transfer)')
    expect(m.res.statusCode, m.res.body).toBe(200)
    expect(m.body['status']).toBe('cleared')
    expect((m.body['legs'] as { transaction: { id: string } | null }[]).map((l) => l.transaction?.id).sort()).toEqual([into, out].sort())
    expect(m.transactions).toBe(2)
    expect(m.data).toBeLessThanOrEqual(MAX.matchTransfer)

    const u = await measure(user, 'DELETE', `${occurrenceUrl(save, due)}/matches/${into}`, undefined, 'unmatch (transfer)')
    expect(u.res.statusCode, u.res.body).toBe(200)
    expect(u.body).toMatchObject({ status: 'upcoming', legs: [{ transaction: null }, { transaction: null }] })
    expect(u.transactions).toBe(2)
    expect(u.data).toBeLessThanOrEqual(MAX.unmatchTransfer)
  })

  it('records and clears an override in one unit of work', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, 3)
    const bill = (await create(user, '/api/v1/recurring-items', {
      name: 'Gym', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-50.00' }],
    })).id as string

    const moved = await measure(user, 'PUT', occurrenceUrl(bill, due), { expectedDate: addDays(due, 2), legs: [{ accountId: checking, amount: '-60.00' }] }, 'override')
    expect(moved.res.statusCode, moved.res.body).toBe(200)
    expect(moved.body).toMatchObject({
      nominalDate: due, expectedDate: addDays(due, 2), moved: true, changed: true, amount: '-60.0000', status: 'upcoming',
    })
    expect(moved.transactions).toBe(2)
    expect(moved.data).toBeLessThanOrEqual(MAX.override)

    const cleared = await measure(user, 'PUT', occurrenceUrl(bill, due), {}, 'override (clear)')
    expect(cleared.body).toMatchObject({ expectedDate: due, moved: false, changed: false, amount: '-50.0000' })
    expect(cleared.transactions).toBe(2)
    expect(cleared.data).toBeLessThanOrEqual(MAX.overrideClear)

    // Skipping an occurrence a transaction settles is still refused.
    const paid = (await create(user, '/api/v1/transactions', { accountId: checking, amount: '-50.00', merchant: 'Gym', transactionDate: today })).id as string
    expect((await send(user, 'POST', `${occurrenceUrl(bill, due)}/matches`, { transactionId: paid })).statusCode).toBe(200)
    const skip = await measure(user, 'PUT', occurrenceUrl(bill, due), { skipped: true }, 'override (refused)')
    expect(skip.res.statusCode).toBe(409)
    expect(skip.body['code']).toBe('occurrence_matched')
  })

  it('lists candidates for an open leg, best first, in one unit of work', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, -1)
    const bill = (await create(user, '/api/v1/recurring-items', {
      name: 'Phone', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-60.00' }],
    })).id as string
    const exact = (await create(user, '/api/v1/transactions', { accountId: checking, amount: '-60.00', merchant: 'Phone', transactionDate: today })).id as string
    const off = (await create(user, '/api/v1/transactions', { accountId: checking, amount: '-90.00', merchant: 'Phone', transactionDate: due })).id as string
    await create(user, '/api/v1/transactions', { accountId: checking, amount: '25.00', merchant: 'Refund', transactionDate: due })

    const c = await measure(user, 'GET', `${occurrenceUrl(bill, due)}/candidates`, undefined, 'candidates')
    expect(c.res.statusCode, c.res.body).toBe(200)
    const legs = c.body['legs'] as { accountId: string; amount: string; candidates: Record<string, unknown>[] }[]
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({ accountId: checking, amount: '-60.0000' })
    expect(legs[0]?.candidates.map((x) => x['transactionId'])).toEqual([exact, off])
    expect(legs[0]?.candidates[0]).toMatchObject({
      dayDifference: 1, amountDifference: '0.0000', confident: true, dismissed: false, score: 1,
    })
    expect(legs[0]?.candidates[1]).toMatchObject({ dayDifference: 0, amountDifference: '-30.0000', confident: false, score: 5 })
    expect(c.transactions).toBe(2)
    expect(c.data).toBeLessThanOrEqual(MAX.candidates)
  })

  it('answers a page of transactions from one load, whatever mix of linked, suggested and dismissed', async () => {
    const { user, today, checking } = await household()
    const bill = async (name: string, amount: string, due: string) => (await create(user, '/api/v1/recurring-items', {
      name, kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount }],
    })).id as string
    const tx = async (amount: string, date: string) => (await create(user, '/api/v1/transactions', {
      accountId: checking, amount, merchant: 'Shop', transactionDate: date,
    })).id as string
    const rentDue = addDays(today, -3)
    const phoneDue = addDays(today, -2)
    const gymDue = addDays(today, -1)
    const rent = await bill('Rent', '-900.00', rentDue)
    const phone = await bill('Phone', '-60.00', phoneDue)
    const gym = await bill('Gym', '-40.00', gymDue)
    const rentPaid = await tx('-900.00', rentDue)
    const phonePaid = await tx('-61.00', phoneDue)
    const gymPaid = await tx('-40.00', gymDue)
    const unrelated = await tx('-3.33', addDays(today, -40))
    expect((await send(user, 'POST', `${occurrenceUrl(rent, rentDue)}/matches`, { transactionId: rentPaid })).statusCode).toBe(200)
    expect((await send(user, 'POST', `${occurrenceUrl(gym, gymDue)}/dismissals`, { transactionId: gymPaid })).statusCode).toBeLessThan(300)

    const page = [rentPaid, phonePaid, gymPaid, unrelated].join(',')
    const m = await measure(user, 'GET', `/api/v1/recurring-items/transaction-matches?transactionIds=${page}`, undefined, 'transaction-matches')
    expect(m.res.statusCode, m.res.body).toBe(200)
    const byId = new Map((m.body['transactions'] as { transactionId: string }[]).map((t) => [t.transactionId, t as Record<string, any>])) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(byId.size).toBe(3)
    expect(byId.get(rentPaid)).toMatchObject({ linked: { itemId: rent, status: 'cleared' }, suggestion: null, dismissed: [] })
    expect(byId.get(phonePaid)).toMatchObject({
      linked: null, dismissed: [], suggestion: { occurrence: { itemId: phone, nominalDate: phoneDue }, candidate: { transactionId: phonePaid } },
    })
    expect(byId.get(gymPaid)).toMatchObject({ linked: null, suggestion: null, dismissed: [{ itemId: gym, nominalDate: gymDue }] })
    expect(m.transactions).toBe(2)
    expect(m.data).toBeLessThanOrEqual(MAX.transactionMatches)

    // A page of rows that are all linked looks for no suggestions.
    const linked = await measure(user, 'GET', `/api/v1/recurring-items/transaction-matches?transactionIds=${rentPaid}`, undefined, 'transaction-matches (all linked)')
    expect(linked.body['transactions']).toHaveLength(1)
    expect(linked.data).toBeLessThanOrEqual(MAX.transactionMatchesLinked)
  })
})

/** The most data statements each request may send: measured, then rounded up by one. */
const MAX = {
  match: 14, matchAgain: 10, matchTransfer: 15, unmatch: 12, unmatchTransfer: 13,
  override: 15, overrideClear: 14, candidates: 10, transactionMatches: 14, transactionMatchesLinked: 12,
}
