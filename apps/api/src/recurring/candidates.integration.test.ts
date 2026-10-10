import { addDays } from '@wickermoney/plugin-sdk/recurrence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser } from '../db/client.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { KyselyRecurringOccurrenceRepository } from './repository/KyselyRecurringOccurrenceRepository.js'

/**
 * What the matching candidate query returns, against real PostgreSQL: linked
 * transactions are left out, and the cap is per account and keeps the newest.
 */

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})

afterAll(async () => {
  await h.close()
})

async function account(user: TestUser, name: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name, accountType: 'checking', initialBalance: '1000.00' },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

async function transaction(user: TestUser, accountId: string, transactionDate: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(user),
    payload: { accountId, amount: '-10.00', merchant: 'Shop', transactionDate },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

/** Runs the repository's candidate query as the user, with a small cap. */
function candidates(user: TestUser, cap: number, accountIds: string[], from: string, through: string) {
  return asUser(h.db, user.id, (trx) =>
    new KyselyRecurringOccurrenceRepository(trx, cap).findCandidates(accountIds, from, through), { readOnly: true })
}

describe('findCandidates', () => {
  it('caps each account on its own and keeps the newest rows', async () => {
    const user = await createUser(h)
    const busy = await account(user, 'Busy')
    const quiet = await account(user, 'Quiet')
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
    const today = (list.json() as { today: string }).today
    const day = (n: number) => addDays(today, -n)

    const busyIds = new Map<number, string>()
    for (const n of [1, 2, 3, 4, 5]) busyIds.set(n, await transaction(user, busy, day(n)))
    const quietOld = await transaction(user, quiet, day(30))

    const rows = await candidates(user, 3, [busy, quiet], day(60), today)

    // The busy account keeps its three newest (days 1, 2, 3 ago); the quiet
    // account's old row is not crowded out by them. Oldest first overall.
    expect(rows.map((r) => r.id)).toEqual([quietOld, busyIds.get(3)!, busyIds.get(2)!, busyIds.get(1)!])
    expect(rows.map((r) => r.transaction_date)).toEqual([day(30), day(3), day(2), day(1)])
  })

  it('leaves out a transaction that already settles an occurrence', async () => {
    const user = await createUser(h)
    const checking = await account(user, 'Checking')
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
    const today = (list.json() as { today: string }).today
    const due = addDays(today, 3)
    const bill = await h.app.inject({
      method: 'POST', url: '/api/v1/recurring-items', headers: auth(user),
      payload: { name: 'Gym', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-10.00' }] },
    })
    expect(bill.statusCode, bill.body).toBe(201)
    const itemId = (bill.json() as { id: string }).id

    const settling = await transaction(user, checking, due)
    const free = await transaction(user, checking, addDays(due, 1))
    const matched = await h.app.inject({
      method: 'POST', url: `/api/v1/recurring-items/${itemId}/occurrences/${due}/matches`,
      headers: auth(user), payload: { transactionId: settling },
    })
    expect(matched.statusCode, matched.body).toBe(200)

    const rows = await candidates(user, 500, [checking], addDays(today, -5), addDays(today, 10))
    expect(rows.map((r) => r.id)).toEqual([free])

    // A page of rows that are all linked has no suggestions to look for, and
    // still reports what each one settles.
    const page = await h.app.inject({
      method: 'GET', url: `/api/v1/recurring-items/transaction-matches?transactionIds=${settling}`, headers: auth(user),
    })
    expect(page.statusCode, page.body).toBe(200)
    const { transactions } = page.json() as { transactions: { transactionId: string; linked: { itemId: string } | null; suggestion: unknown }[] }
    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toMatchObject({ transactionId: settling, linked: { itemId }, suggestion: null })
  })

  it('returns nothing for no accounts', async () => {
    const user = await createUser(h)
    expect(await candidates(user, 500, [], '2000-01-01', '2100-01-01')).toEqual([])
  })
})
