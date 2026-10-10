import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * The transaction-matches request reads the recurring data once for both the
 * occurrences it describes and the suggestions it makes. These scenarios put
 * the two far apart in time, and two users side by side, to show that one
 * load serves each correctly and stays inside its own request.
 */

let h: Harness

function plusDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

async function send(user: TestUser, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) {
  const res = await h.app.inject({ method, url, headers: auth(user), ...(payload === undefined ? {} : { payload }) })
  expect(res.statusCode, `${url} ${res.body}`).toBeLessThan(300)
  return res.json() as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** A user with a checking account. */
async function household() {
  const user = await createUser(h)
  const { id: checking } = await send(user, 'POST', '/api/v1/accounts', { name: 'Checking', accountType: 'checking', initialBalance: '5000.00' })
  const { today } = await send(user, 'GET', '/api/v1/recurring-items')
  return { user, checking: checking as string, today: today as string }
}

async function bill(user: TestUser, checking: string, name: string, amount: string, start: string): Promise<string> {
  return (await send(user, 'POST', '/api/v1/recurring-items', {
    name, kind: 'bill', frequency: 'monthly', seriesStartDate: start, legs: [{ accountId: checking, amount }],
  })).id as string
}

async function transaction(user: TestUser, checking: string, amount: string, transactionDate: string): Promise<string> {
  return (await send(user, 'POST', '/api/v1/transactions', { accountId: checking, amount, merchant: 'Shop', transactionDate })).id as string
}

const matches = (user: TestUser, ids: readonly string[]) =>
  send(user, 'GET', `/api/v1/recurring-items/transaction-matches?transactionIds=${ids.join(',')}`)

beforeAll(async () => {
  h = await createHarness()
})

afterAll(async () => {
  await h.close()
})

describe('transaction matches from one shared load', () => {
  it('describes an old matched occurrence and suggests a current one in the same request', async () => {
    const { user, checking, today } = await household()
    const old = plusDays(today, -150)
    const rent = await bill(user, checking, 'Rent', '-900.00', old)
    const phone = await bill(user, checking, 'Phone', '-60.00', plusDays(today, -2))
    const oldPayment = await transaction(user, checking, '-900.00', old)
    const phonePayment = await transaction(user, checking, '-61.00', plusDays(today, -1))
    await send(user, 'POST', `/api/v1/recurring-items/${rent}/occurrences/${old}/matches`, { transactionId: oldPayment })

    const out = await matches(user, [oldPayment, phonePayment])
    const byId = new Map((out.transactions as { transactionId: string }[]).map((t) => [t.transactionId, t as Record<string, any>])) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(byId.get(oldPayment)).toMatchObject({
      linked: { itemId: rent, nominalDate: old, status: 'cleared' }, suggestion: null, dismissed: [],
    })
    expect(byId.get(phonePayment)).toMatchObject({
      linked: null, dismissed: [], suggestion: { occurrence: { itemId: phone }, candidate: { transactionId: phonePayment } },
    })
    expect(byId.size).toBe(2)

    // The same suggestion the suggestions endpoint makes on its own.
    const list = await send(user, 'GET', '/api/v1/recurring-items/suggestions')
    expect(list.suggestions).toEqual([byId.get(phonePayment)?.['suggestion']])
  })

  it('describes a dismissal long ago with no suggestions to make', async () => {
    const { user, checking, today } = await household()
    const old = plusDays(today, -120)
    const gym = await bill(user, checking, 'Gym', '-40.00', old)
    const payment = await transaction(user, checking, '-41.00', plusDays(old, 1))
    await send(user, 'POST', `/api/v1/recurring-items/${gym}/occurrences/${old}/dismissals`, { transactionId: payment })
    const linkedElsewhere = await transaction(user, checking, '-5.00', today)
    await send(user, 'POST', `/api/v1/recurring-items/${gym}/occurrences/${plusDays(old, 30)}/matches`, { transactionId: linkedElsewhere })

    const out = await matches(user, [payment])
    expect(out.transactions).toEqual([
      expect.objectContaining({ transactionId: payment, linked: null, suggestion: null, dismissed: [expect.objectContaining({ itemId: gym, nominalDate: old })] }),
    ])
  })

  it('keeps two users side by side, each seeing only their own, when requests overlap', async () => {
    const a = await household()
    const b = await household()
    const dueA = plusDays(a.today, -2)
    const dueB = plusDays(b.today, -3)
    const itemA = await bill(a.user, a.checking, 'Only A', '-70.00', dueA)
    const itemB = await bill(b.user, b.checking, 'Only B', '-80.00', dueB)
    const txA = await transaction(a.user, a.checking, '-71.00', plusDays(dueA, 1))
    const txB = await transaction(b.user, b.checking, '-81.00', plusDays(dueB, 1))

    const [outA, outB, crossed] = await Promise.all([matches(a.user, [txA]), matches(b.user, [txB]), matches(a.user, [txB])])
    expect(outA.transactions.map((t: any) => [t.transactionId, t.suggestion.occurrence.itemId])).toEqual([[txA, itemA]]) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(outB.transactions.map((t: any) => [t.transactionId, t.suggestion.occurrence.itemId])).toEqual([[txB, itemB]]) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(crossed.transactions).toEqual([])
  })
})
