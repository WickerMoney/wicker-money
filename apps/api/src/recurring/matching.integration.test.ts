import { addDays } from '@wickermoney/plugin-sdk/recurrence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser } from '../db/client.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * Paid / landed matching end to end against real PostgreSQL: recording a
 * skip, move or amount for one occurrence, matching transactions to
 * occurrences, and what that does to "Until payday" and the forecast.
 *
 * Every scenario uses its own user, so balances and "tracked" state never
 * leak between tests. Dates are relative to the user's today as the API
 * reports it.
 */

let h: Harness

interface Leg { accountId: string; amount: string; transaction: { id: string; date: string; amount: string } | null }
interface Occurrence {
  itemId: string; date: string; nominalDate: string; expectedDate: string; status: string
  moved: boolean; changed: boolean; amount: string; legs: Leg[]
}

/** A user with a checking and a savings account, each holding 1,000. */
async function household(): Promise<{ user: TestUser; today: string; checking: string; savings: string }> {
  const user = await createUser(h)
  const account = async (name: string, accountType: string) => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(user), payload: { name, accountType, initialBalance: '1000.00' },
    })
    expect(res.statusCode).toBe(201)
    return (res.json() as { id: string }).id
  }
  const checking = await account('Checking', 'checking')
  const savings = await account('Savings', 'savings')
  const list = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
  return { user, today: (list.json() as { today: string }).today, checking, savings }
}

/** Creates an item and returns its id. */
async function item(user: TestUser, payload: Record<string, unknown>): Promise<string> {
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/recurring-items', headers: auth(user), payload })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

/** Creates a transaction and returns its id. */
async function transaction(user: TestUser, accountId: string, amount: string, transactionDate: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(user),
    payload: { accountId, amount, merchant: 'Bank', transactionDate },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

const occurrenceUrl = (itemId: string, date: string) => `/api/v1/recurring-items/${itemId}/occurrences/${date}`

async function match(user: TestUser, itemId: string, date: string, transactionId: string) {
  return h.app.inject({
    method: 'POST', url: `${occurrenceUrl(itemId, date)}/matches`, headers: auth(user), payload: { transactionId },
  })
}

async function override(user: TestUser, itemId: string, date: string, payload: Record<string, unknown>) {
  return h.app.inject({ method: 'PUT', url: occurrenceUrl(itemId, date), headers: auth(user), payload })
}

async function occurrence(user: TestUser, itemId: string, date: string): Promise<Occurrence> {
  const res = await h.app.inject({ method: 'GET', url: occurrenceUrl(itemId, date), headers: auth(user) })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as Occurrence
}

interface Upcoming {
  window: { from: string; through: string; payday: string | null }
  accounts: { accountId: string; balance: string; lowest: { date: string; balance: string } }[]
  occurrences: Occurrence[]
}

async function upcoming(user: TestUser): Promise<Upcoming> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/core/recurring-items/upcoming', headers: auth(user) })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as Upcoming
}

/** How many occurrence rows the user has for an item. */
async function recordCount(user: TestUser, itemId: string): Promise<number> {
  const rows = await asUser(h.db, user.id, (trx) =>
    trx.selectFrom('core.recurring_occurrences').select('id').where('recurring_item_id', '=', itemId).execute())
  return rows.length
}

beforeAll(async () => {
  h = await createHarness()
})

afterAll(async () => {
  await h.close()
})

describe('recording one occurrence', () => {
  it('skips one occurrence, keeps it findable, and leaves it out of Until payday', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, 3)
    const bill = await item(user, { name: 'Gym', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-50.00' }] })

    const res = await override(user, bill, due, { skipped: true })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ status: 'skipped', nominalDate: due })

    const listed = await h.app.inject({ method: 'GET', url: `/api/v1/recurring-items/occurrences?itemId=${bill}`, headers: auth(user) })
    expect((listed.json() as { occurrences: Occurrence[] }).occurrences[0]).toMatchObject({ status: 'skipped', date: due })

    const out = await upcoming(user)
    expect(out.occurrences.find((o) => o.itemId === bill && o.nominalDate === due)).toBeUndefined()
    expect(out.accounts.find((a) => a.accountId === checking)?.lowest.balance).toBe('1000.0000')

    const items = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
    const view = (items.json() as { items: { id: string; nextDue: string }[] }).items.find((i) => i.id === bill)
    expect(view?.nextDue).not.toBe(due)
  })

  it('moves one occurrence and changes its amount, and puts it back with an empty body', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, 3)
    const bill = await item(user, { name: 'Power', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-80.00' }] })

    const moved = await override(user, bill, due, { expectedDate: addDays(due, 2), legs: [{ accountId: checking, amount: '-95.50' }] })
    expect(moved.statusCode, moved.body).toBe(200)
    expect(moved.json()).toMatchObject({ expectedDate: addDays(due, 2), moved: true, changed: true, amount: '-95.5000' })

    const out = await upcoming(user)
    const placed = out.occurrences.find((o) => o.itemId === bill)
    expect(placed?.date).toBe(addDays(due, 2))

    const reset = await override(user, bill, due, {})
    expect(reset.json()).toMatchObject({ moved: false, changed: false, amount: '-80.0000', status: 'upcoming' })
    expect(await recordCount(user, bill)).toBe(0)
  })

  it('refuses what an occurrence cannot be', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, 3)
    const bill = await item(user, { name: 'Phone', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-40.00' }] })
    const move = await item(user, {
      name: 'Save', kind: 'transfer', frequency: 'monthly', seriesStartDate: due,
      legs: [{ accountId: checking, amount: '-100.00' }, { accountId: savings, amount: '100.00' }],
    })

    expect((await override(user, bill, addDays(due, 1), { skipped: true })).statusCode).toBe(404)
    const cases: [string, Record<string, unknown>, string][] = [
      [bill, { expectedDate: addDays(due, 40) }, 'at most 31 days'],
      [bill, { skipped: true, expectedDate: addDays(due, 1) }, 'not expected on any date'],
      [bill, { legs: [{ accountId: savings, amount: '-40.00' }] }, 'account this item uses'],
      [bill, { legs: [{ accountId: checking, amount: '40.00' }] }, 'must leave it'],
      [bill, { legs: [{ accountId: checking, amount: '0' }] }, 'Must be more than 0'],
      [move, { legs: [{ accountId: checking, amount: '-150.00' }] }, 'net to zero'],
    ]
    for (const [id, body, message] of cases) {
      const res = await override(user, id, due, body)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
      expect(res.json().message).toContain(message)
    }

    const both = await override(user, move, due, {
      legs: [{ accountId: checking, amount: '-150.00' }, { accountId: savings, amount: '150.00' }],
    })
    expect(both.statusCode, both.body).toBe(200)
    expect(both.json()).toMatchObject({ amount: '150.0000', changed: true })
  })

  it("does not show one user's occurrence to another", async () => {
    const a = await household()
    const b = await household()
    const due = addDays(a.today, 3)
    const bill = await item(a.user, { name: 'Private', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: a.checking, amount: '-1.00' }] })
    const res = await h.app.inject({ method: 'GET', url: occurrenceUrl(bill, due), headers: auth(b.user) })
    expect(res.statusCode).toBe(404)
    expect((await override(b.user, bill, due, { skipped: true })).statusCode).toBe(404)
  })
})

describe('matching', () => {
  it('stops counting a paycheck that arrived early, and moves payday to the next one', async () => {
    const { user, today, checking } = await household()
    const payday = addDays(today, 2)
    const pay = await item(user, {
      name: 'Pay', kind: 'income', frequency: 'biweekly', seriesStartDate: payday, legs: [{ accountId: checking, amount: '2000.00' }],
    })
    await item(user, { name: 'Rent', kind: 'bill', frequency: 'monthly', seriesStartDate: addDays(today, 5), legs: [{ accountId: checking, amount: '-2500.00' }] })

    const before = await upcoming(user)
    expect(before.window.payday).toBe(payday)

    // It landed today, two days early: the balance already has it.
    const deposit = await transaction(user, checking, '2000.00', today)
    const candidates = await h.app.inject({ method: 'GET', url: `${occurrenceUrl(pay, payday)}/candidates`, headers: auth(user) })
    expect(candidates.json().legs[0].candidates[0]).toMatchObject({ transactionId: deposit, dayDifference: -2, confident: true })

    const res = await match(user, pay, payday, deposit)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ status: 'cleared', legs: [{ accountId: checking, transaction: { id: deposit } }] })

    const after = await upcoming(user)
    expect(after.window.payday).toBe(addDays(payday, 14))
    // 3,000 today; rent takes 2,500 and the paycheck is not added a second time.
    const lowest = after.accounts.find((a) => a.accountId === checking)?.lowest.balance
    expect(lowest).toBe('500.0000')
    expect(after.occurrences.find((o) => o.itemId === pay && o.nominalDate === payday)?.status).toBe('cleared')
  })

  it('links both rows of a transfer from either side, and unlinks both', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, 1)
    const save = await item(user, {
      name: 'Save', kind: 'transfer', frequency: 'monthly', seriesStartDate: due,
      legs: [{ accountId: checking, amount: '-100.00' }, { accountId: savings, amount: '100.00' }],
    })
    const transfer = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(user),
      payload: { fromAccountId: checking, toAccountId: savings, amount: '100.00', transactionDate: today },
    })
    expect(transfer.statusCode, transfer.body).toBe(201)
    const legs = (transfer.json() as { legs: { id: string; account_id: string }[] }).legs
    const into = legs.find((l) => l.account_id === savings)?.id as string

    const res = await match(user, save, due, into)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().status).toBe('cleared')

    const undone = await h.app.inject({ method: 'DELETE', url: `${occurrenceUrl(save, due)}/matches/${into}`, headers: auth(user) })
    expect(undone.statusCode, undone.body).toBe(200)
    expect(undone.json()).toMatchObject({ status: 'upcoming', legs: [{ transaction: null }, { transaction: null }] })
    expect(await recordCount(user, save)).toBe(0)
  })

  it('refuses a transaction that cannot settle the leg', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, 1)
    const bill = await item(user, { name: 'Water', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-30.00' }] })
    const other = await item(user, { name: 'Trash', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-30.00' }] })

    const wrongAccount = await transaction(user, savings, '-30.00', today)
    expect((await match(user, bill, due, wrongAccount)).statusCode).toBe(400)
    const wrongWay = await transaction(user, checking, '30.00', today)
    expect((await match(user, bill, due, wrongWay)).statusCode).toBe(400)

    const paid = await transaction(user, checking, '-30.00', today)
    expect((await match(user, bill, due, paid)).statusCode).toBe(200)
    // Again is a no-op, not an error.
    expect((await match(user, bill, due, paid)).statusCode).toBe(200)
    const elsewhere = await match(user, other, due, paid)
    expect([elsewhere.statusCode, elsewhere.json().code]).toEqual([409, 'already_matched'])
    const second = await match(user, bill, due, await transaction(user, checking, '-30.00', today))
    expect([second.statusCode, second.json().code]).toEqual([409, 'leg_matched'])

    const skip = await override(user, bill, due, { skipped: true })
    expect([skip.statusCode, skip.json().code]).toEqual([409, 'occurrence_matched'])
    await override(user, other, due, { skipped: true })
    const onSkipped = await match(user, other, due, await transaction(user, checking, '-30.00', today))
    expect([onSkipped.statusCode, onSkipped.json().code]).toEqual([409, 'occurrence_skipped'])

    const stranger = await household()
    const theirs = await transaction(stranger.user, stranger.checking, '-30.00', stranger.today)
    expect((await match(user, bill, due, theirs)).statusCode).toBe(404)
  })

  it('goes back to unsettled when the matched transaction is deleted', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, 1)
    const bill = await item(user, { name: 'Net', kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '-60.00' }] })
    const paid = await transaction(user, checking, '-60.00', today)
    await match(user, bill, due, paid)

    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/transactions/${paid}`, headers: auth(user) })
    expect(res.statusCode).toBe(204)
    expect((await occurrence(user, bill, due)).status).toBe('upcoming')
  })
})

describe('late occurrences', () => {
  /** A weekly bill whose last-but-one occurrence was matched, so it is tracked. */
  async function trackedWeekly() {
    const hh = await household()
    const start = addDays(hh.today, -9) // occurrences 9 and 2 days ago, then in 5 days
    const bill = await item(hh.user, {
      name: 'Childcare', kind: 'bill', frequency: 'weekly', seriesStartDate: start, legs: [{ accountId: hh.checking, amount: '-200.00' }],
    })
    return { ...hh, bill, start }
  }

  it('assumes an untracked item already posted, as before matching existed', async () => {
    const { user, checking, bill, start } = await trackedWeekly()
    expect((await occurrence(user, bill, addDays(start, 7))).status).toBe('assumed')
    const out = await upcoming(user)
    expect(out.occurrences.filter((o) => o.itemId === bill).map((o) => o.status)).not.toContain('late')
    // No income, so a 14-day window: the occurrences in 5 and 12 days, nothing from the past.
    expect(out.accounts.find((a) => a.accountId === checking)?.lowest.balance).toBe('600.0000')
  })

  it('carries a late occurrence of a tracked item into tomorrow until it arrives', async () => {
    const { user, today, checking, bill, start } = await trackedWeekly()
    const paid = await transaction(user, checking, '-200.00', start)
    expect((await match(user, bill, start, paid)).statusCode).toBe(200)

    const lateDate = addDays(start, 7)
    expect((await occurrence(user, bill, lateDate)).status).toBe('late')

    const out = await upcoming(user)
    const carried = out.occurrences.find((o) => o.itemId === bill && o.nominalDate === lateDate)
    expect(carried).toMatchObject({ status: 'late', date: addDays(today, 1), expectedDate: lateDate })
    // 1,000 − 200 (matched, already in the balance) = 800 today; then the late
    // one tomorrow and the two in the 14-day window: 800 − 600.
    expect(out.accounts.find((a) => a.accountId === checking)?.lowest.balance).toBe('200.0000')

    const items = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
    expect((items.json() as { items: { id: string; tracked: boolean; late: string[] }[] }).items.find((i) => i.id === bill))
      .toMatchObject({ tracked: true, late: [lateDate] })

    const suggestions = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items/suggestions', headers: auth(user) })
    expect((suggestions.json() as { suggestions: unknown[] }).suggestions).toEqual([])
    const arrived = await transaction(user, checking, '-200.00', today)
    const offered = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items/suggestions', headers: auth(user) })
    expect((offered.json() as { suggestions: { occurrence: Occurrence; candidate: { transactionId: string } }[] }).suggestions)
      .toMatchObject([{ occurrence: { itemId: bill, nominalDate: lateDate }, candidate: { transactionId: arrived } }])
  })

  it('forecasts with the same rules', async () => {
    const { user, today, checking, bill, start } = await trackedWeekly()
    await match(user, bill, start, await transaction(user, checking, '-200.00', start))
    const res = await h.app.inject({
      method: 'GET', url: `/api/v1/core/recurring-items/forecast?accountId=${checking}&horizon=30d`, headers: auth(user),
    })
    expect(res.statusCode, res.body).toBe(200)
    const body = res.json() as { days: { date: string; balance: string }[]; entries: { nominalDate: string; date: string; status: string; amount: string }[] }
    expect(body.entries[0]).toMatchObject({ nominalDate: addDays(start, 7), date: addDays(today, 1), status: 'late', amount: '-200.0000' })
    expect(body.days[0]?.balance).toBe('600.0000')
  })
})

describe('editing an item', () => {
  it('drops one-occurrence amounts that no longer fit the legs', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, 3)
    const payload = { name: 'Pay', kind: 'income', frequency: 'monthly', seriesStartDate: due }
    const pay = await item(user, { ...payload, legs: [{ accountId: checking, amount: '900.00' }, { accountId: savings, amount: '100.00' }] })
    await override(user, pay, due, { legs: [{ accountId: checking, amount: '950.00' }, { accountId: savings, amount: '50.00' }] })

    const res = await h.app.inject({
      method: 'PUT', url: `/api/v1/recurring-items/${pay}`, headers: auth(user),
      payload: { ...payload, legs: [{ accountId: checking, amount: '1000.00' }] },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect((await occurrence(user, pay, due)).legs).toEqual([{ accountId: checking, amount: '950.0000', transaction: null }])
  })
})
