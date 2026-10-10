import { addDays } from '@wickermoney/plugin-sdk/date'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser } from '../db/client.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * Dismissing suggested matches, and matching from the transaction side,
 * end to end against real PostgreSQL.
 *
 * Every scenario uses its own user so suggestions never leak between tests.
 * Dates are relative to the user's today as the API reports it.
 */

let h: Harness

interface OccurrenceRef { itemId: string; nominalDate: string; status: string; name: string }
interface Suggestion { occurrence: OccurrenceRef; accountId: string; candidate: { transactionId: string } }
interface SuggestionList {
  suggestions: Suggestion[]
  dismissed: { occurrence: OccurrenceRef; transaction: { id: string } }[]
}
interface TransactionMatchList {
  transactions: { transactionId: string; linked: OccurrenceRef | null; suggestion: Suggestion | null; dismissed: OccurrenceRef[] }[]
}
interface TransactionCandidates {
  linked: OccurrenceRef | null
  candidates: { occurrence: OccurrenceRef; dismissed: boolean; candidate: { confident: boolean } }[]
}

/** A user with a checking and a savings account. */
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

async function item(user: TestUser, payload: Record<string, unknown>): Promise<string> {
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/recurring-items', headers: auth(user), payload })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

/** A monthly bill on `accountId` whose occurrence falls on `due`. */
function bill(user: TestUser, accountId: string, name: string, amount: string, due: string): Promise<string> {
  return item(user, { name, kind: 'bill', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId, amount }] })
}

async function transaction(user: TestUser, accountId: string, amount: string, transactionDate: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(user),
    payload: { accountId, amount, merchant: 'Bank', transactionDate },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

const occurrenceUrl = (itemId: string, date: string) => `/api/v1/recurring-items/${itemId}/occurrences/${date}`

function dismiss(user: TestUser, itemId: string, date: string, transactionId: string) {
  return h.app.inject({
    method: 'POST', url: `${occurrenceUrl(itemId, date)}/dismissals`, headers: auth(user), payload: { transactionId },
  })
}

function undismiss(user: TestUser, itemId: string, date: string, transactionId: string) {
  return h.app.inject({ method: 'DELETE', url: `${occurrenceUrl(itemId, date)}/dismissals/${transactionId}`, headers: auth(user) })
}

function match(user: TestUser, itemId: string, date: string, transactionId: string) {
  return h.app.inject({
    method: 'POST', url: `${occurrenceUrl(itemId, date)}/matches`, headers: auth(user), payload: { transactionId },
  })
}

async function suggestions(user: TestUser): Promise<SuggestionList> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items/suggestions', headers: auth(user) })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as SuggestionList
}

async function forTransactions(user: TestUser, ids: readonly string[]): Promise<TransactionMatchList> {
  const res = await h.app.inject({
    method: 'GET', url: `/api/v1/recurring-items/transaction-matches?transactionIds=${ids.join(',')}`, headers: auth(user),
  })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as TransactionMatchList
}

async function candidatesFor(user: TestUser, transactionId: string): Promise<TransactionCandidates> {
  const res = await h.app.inject({
    method: 'GET', url: `/api/v1/recurring-items/transaction-matches/${transactionId}`, headers: auth(user),
  })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as TransactionCandidates
}

/** The user's dismissal rows, read under their own row-level security. */
async function dismissalRows(user: TestUser) {
  return asUser(h.db, user.id, (trx) => trx.selectFrom('core.recurring_match_dismissals').selectAll().execute())
}

beforeAll(async () => {
  h = await createHarness()
})

afterAll(async () => {
  await h.close()
})

describe('dismissing a suggestion', () => {
  it('stops suggesting that pair, lists it as dismissed, and undo brings it back', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, -2)
    const internet = await bill(user, checking, 'Internet', '-80.00', due)
    const tx = await transaction(user, checking, '-78.00', addDays(today, -1))

    expect((await suggestions(user)).suggestions.map((s) => s.candidate.transactionId)).toEqual([tx])

    const res = await dismiss(user, internet, due, tx)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ itemId: internet, nominalDate: due, transactionIds: [tx] })
    // Twice is harmless.
    expect((await dismiss(user, internet, due, tx)).statusCode).toBe(200)
    expect(await dismissalRows(user)).toHaveLength(1)

    const after = await suggestions(user)
    expect(after.suggestions).toEqual([])
    expect(after.dismissed).toMatchObject([{ occurrence: { itemId: internet, nominalDate: due }, transaction: { id: tx } }])

    // Still offered by hand, flagged.
    const candidates = await h.app.inject({ method: 'GET', url: `${occurrenceUrl(internet, due)}/candidates`, headers: auth(user) })
    const legs = (candidates.json() as { legs: { candidates: { transactionId: string; dismissed: boolean }[] }[] }).legs
    expect(legs[0]?.candidates).toMatchObject([{ transactionId: tx, dismissed: true }])

    const undo = await undismiss(user, internet, due, tx)
    expect(undo.statusCode, undo.body).toBe(204)
    const restored = await suggestions(user)
    expect(restored.suggestions.map((s) => s.candidate.transactionId)).toEqual([tx])
    expect(restored.dismissed).toEqual([])
    expect((await undismiss(user, internet, due, tx)).statusCode).toBe(404)
  })

  it('still suggests the same transaction for another occurrence', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, -2)
    const water = await bill(user, checking, 'Water', '-50.00', due)
    const power = await bill(user, checking, 'Power', '-55.00', addDays(today, -3))
    const tx = await transaction(user, checking, '-50.00', due)

    const first = (await suggestions(user)).suggestions
    expect(first).toHaveLength(1)
    expect(first[0]?.occurrence.itemId).toBe(water)

    expect((await dismiss(user, water, due, tx)).statusCode).toBe(200)
    const second = (await suggestions(user)).suggestions
    expect(second).toHaveLength(1)
    expect(second[0]?.occurrence.itemId).toBe(power)
    expect(second[0]?.candidate.transactionId).toBe(tx)
  })

  it('survives the occurrence row coming and going, and a by-hand match clears it', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, -2)
    const phone = await bill(user, checking, 'Phone', '-60.00', due)
    const wrong = await transaction(user, checking, '-58.00', due)
    const right = await transaction(user, checking, '-60.00', addDays(due, 1))

    expect((await dismiss(user, phone, due, wrong)).statusCode).toBe(200)
    // Matching then unmatching creates and deletes the occurrence row.
    expect((await match(user, phone, due, right)).statusCode).toBe(200)
    const unmatched = await h.app.inject({ method: 'DELETE', url: `${occurrenceUrl(phone, due)}/matches/${right}`, headers: auth(user) })
    expect(unmatched.statusCode, unmatched.body).toBe(200)
    const rows = await asUser(h.db, user.id, (trx) =>
      trx.selectFrom('core.recurring_occurrences').select('id').where('recurring_item_id', '=', phone).execute())
    expect(rows).toEqual([])
    expect((await dismissalRows(user)).map((r) => r.transaction_id)).toEqual([wrong])

    // Matching the dismissed transaction by hand is allowed and forgets the dismissal.
    expect((await match(user, phone, due, wrong)).statusCode).toBe(200)
    expect(await dismissalRows(user)).toEqual([])
  })

  it('refuses what cannot be dismissed', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, -2)
    const rent = await bill(user, checking, 'Rent', '-900.00', due)
    const elsewhere = await transaction(user, savings, '-900.00', due)
    const paid = await transaction(user, checking, '-900.00', due)

    expect((await dismiss(user, rent, due, elsewhere)).statusCode).toBe(400)
    expect((await dismiss(user, rent, addDays(due, 1), paid)).statusCode).toBe(404)
    expect((await dismiss(user, rent, due, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    expect((await match(user, rent, due, paid)).statusCode).toBe(200)
    const matched = await dismiss(user, rent, due, paid)
    expect(matched.statusCode).toBe(409)
    expect(matched.json()).toMatchObject({ code: 'already_matched' })
  })

  it('dismisses both rows of a transfer together', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, -1)
    const fund = await item(user, {
      name: 'Savings', kind: 'transfer', frequency: 'monthly', seriesStartDate: due,
      legs: [{ accountId: checking, amount: '-200.00' }, { accountId: savings, amount: '200.00' }],
    })
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(user),
      payload: { fromAccountId: checking, toAccountId: savings, amount: '200.00', transactionDate: due, description: 'To savings' },
    })
    expect(res.statusCode, res.body).toBe(201)
    const legs = (res.json() as { legs: { id: string; account_id: string }[] }).legs
    const out = legs.find((l) => l.account_id === checking)?.id as string
    expect((await suggestions(user)).suggestions).toHaveLength(2)

    const dismissed = await dismiss(user, fund, due, out)
    expect((dismissed.json() as { transactionIds: string[] }).transactionIds.sort()).toEqual(legs.map((l) => l.id).sort())
    expect((await suggestions(user)).suggestions).toEqual([])

    expect((await undismiss(user, fund, due, out)).statusCode).toBe(204)
    expect((await suggestions(user)).suggestions).toHaveLength(2)
  })

  it('goes with the transaction or the item when either is deleted', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, -2)
    const gym = await bill(user, checking, 'Gym', '-40.00', due)
    const tv = await bill(user, checking, 'TV', '-40.00', due)
    const first = await transaction(user, checking, '-40.00', due)
    const second = await transaction(user, checking, '-41.00', due)
    expect((await dismiss(user, gym, due, first)).statusCode).toBe(200)
    expect((await dismiss(user, tv, due, second)).statusCode).toBe(200)
    expect(await dismissalRows(user)).toHaveLength(2)

    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/transactions/${first}`, headers: auth(user) })).statusCode).toBe(204)
    expect((await dismissalRows(user)).map((r) => r.transaction_id)).toEqual([second])
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/recurring-items/${tv}`, headers: auth(user) })).statusCode).toBe(204)
    expect(await dismissalRows(user)).toEqual([])
  })
})

describe('isolation', () => {
  it("does not let one user see, dismiss or undo another user's pairs", async () => {
    const alice = await household()
    const bob = await household()
    const due = addDays(alice.today, -2)
    const internet = await bill(alice.user, alice.checking, 'Internet', '-80.00', due)
    const tx = await transaction(alice.user, alice.checking, '-80.00', due)
    expect((await dismiss(alice.user, internet, due, tx)).statusCode).toBe(200)

    // Bob can neither name Alice's item nor her transaction.
    expect((await dismiss(bob.user, internet, due, tx)).statusCode).toBe(404)
    expect((await undismiss(bob.user, internet, due, tx)).statusCode).toBe(404)
    const bobBill = await bill(bob.user, bob.checking, 'Internet', '-80.00', due)
    expect((await dismiss(bob.user, bobBill, due, tx)).statusCode).toBe(404)

    expect(await dismissalRows(bob.user)).toEqual([])
    expect((await suggestions(bob.user)).dismissed).toEqual([])
    expect((await forTransactions(bob.user, [tx])).transactions).toEqual([])
    expect((await h.app.inject({
      method: 'GET', url: `/api/v1/recurring-items/transaction-matches/${tx}`, headers: auth(bob.user),
    })).statusCode).toBe(404)

    // Still there for Alice.
    expect(await dismissalRows(alice.user)).toHaveLength(1)
  })

  it("refuses a dismissal naming another user's transaction, even with the API bypassed", async () => {
    const alice = await household()
    const bob = await household()
    const aliceTx = await transaction(alice.user, alice.checking, '-10.00', alice.today)
    const bobItem = await bill(bob.user, bob.checking, 'Thing', '-10.00', bob.today)
    const error = await asUser(h.db, bob.user.id, (trx) => trx.insertInto('core.recurring_match_dismissals')
      .values({ user_id: bob.user.id, transaction_id: aliceTx, recurring_item_id: bobItem, nominal_date: bob.today })
      .execute()).then(() => undefined, (e: unknown) => e as { constraint?: string })
    expect(error?.constraint).toBe('fk_recurring_match_dismissals_transaction_id_owned')
  })
})

describe('matching from the transaction side', () => {
  it('summarises a page of transactions in one request: linked, suggested and dismissed', async () => {
    const { user, today, checking } = await household()
    const due = addDays(today, -3)
    const rent = await bill(user, checking, 'Rent', '-900.00', due)
    const phone = await bill(user, checking, 'Phone', '-60.00', due)
    const water = await bill(user, checking, 'Water', '-30.00', due)
    const paid = await transaction(user, checking, '-900.00', due)
    const suggested = await transaction(user, checking, '-61.00', addDays(due, 1))
    const notWater = await transaction(user, checking, '-29.00', due)
    const unrelated = await transaction(user, checking, '-5.00', due)
    expect((await match(user, rent, due, paid)).statusCode).toBe(200)
    expect((await dismiss(user, water, due, notWater)).statusCode).toBe(200)

    const list = await forTransactions(user, [paid, suggested, notWater, unrelated])
    const byId = new Map(list.transactions.map((t) => [t.transactionId, t]))
    expect(byId.get(paid)).toMatchObject({ linked: { itemId: rent, nominalDate: due, status: 'cleared' }, suggestion: null, dismissed: [] })
    expect(byId.get(suggested)).toMatchObject({ linked: null, suggestion: { occurrence: { itemId: phone } }, dismissed: [] })
    expect(byId.get(notWater)).toMatchObject({ linked: null, suggestion: null, dismissed: [{ itemId: water, nominalDate: due }] })
    expect(byId.has(unrelated)).toBe(false)
  })

  it('lists the occurrences one transaction could settle, and nothing once it is matched', async () => {
    const { user, today, checking, savings } = await household()
    const due = addDays(today, -3)
    const phone = await bill(user, checking, 'Phone', '-60.00', due)
    const gym = await bill(user, checking, 'Gym', '-45.00', addDays(due, 6))
    await bill(user, savings, 'Elsewhere', '-60.00', due)
    await item(user, { name: 'Pay', kind: 'income', frequency: 'monthly', seriesStartDate: due, legs: [{ accountId: checking, amount: '60.00' }] })
    const tx = await transaction(user, checking, '-60.00', due)
    expect((await dismiss(user, phone, due, tx)).statusCode).toBe(200)

    const open = await candidatesFor(user, tx)
    expect(open.linked).toBeNull()
    expect(open.candidates.map((c) => c.occurrence.itemId)).toEqual([phone, gym])
    expect(open.candidates[0]).toMatchObject({ dismissed: true, candidate: { confident: true } })
    expect(open.candidates[1]).toMatchObject({ dismissed: false, candidate: { confident: false } })

    expect((await match(user, gym, addDays(due, 6), tx)).statusCode).toBe(200)
    const linked = await candidatesFor(user, tx)
    expect(linked.linked).toMatchObject({ itemId: gym, nominalDate: addDays(due, 6) })
    expect(linked.candidates).toEqual([])
  })

  it('refuses a bad transaction id list', async () => {
    const { user } = await household()
    const bad = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items/transaction-matches?transactionIds=nope', headers: auth(user) })
    expect(bad.statusCode).toBe(400)
    const none = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items/transaction-matches', headers: auth(user) })
    expect(none.statusCode).toBe(400)
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const tooMany = await h.app.inject({
      method: 'GET', url: `/api/v1/recurring-items/transaction-matches?transactionIds=${many.join(',')}`, headers: auth(user),
    })
    expect(tooMany.statusCode).toBe(400)
  })
})
