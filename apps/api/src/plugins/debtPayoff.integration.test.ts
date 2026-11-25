import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asPlugin } from '../db/client.js'
import { auth, createHarness, createUser, TEST_APP_ROLE, type Harness, type TestUser } from '../testing/harness.js'

/**
 * The debt payoff plugin against real PostgreSQL: CRUD, row-level security
 * between two people, the composite account key, settings, the plan, and the
 * grant boundary of the plugin's own database role.
 */

const PLUGIN = 'wickermoney.debt-payoff'
const BASE = `/api/v1/p/${PLUGIN}`

let h: Harness
let user: TestUser
let other: TestUser

const ROLE = `${TEST_APP_ROLE}_plugin_debt_payoff`

/** Runs one statement as the plugin's own database role, bound to a user. */
const asRole = (userId: string, text: string, ...params: unknown[]) =>
  asPlugin(h.db, ROLE, userId, async (trx) => {
    const parts = text.split('?')
    const query = sql(parts as unknown as TemplateStringsArray, ...params)
    return (await query.execute(trx)).rows
  })

const headers = (u: TestUser) => ({ ...auth(u), 'x-wickermoney-plugin': PLUGIN })

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
  other = await createUser(h)
  const { seedBundledPlugins } = await import('./registry.js')
  await seedBundledPlugins(h.db)
})
afterAll(async () => { await h.close() })

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, u: TestUser, payload?: unknown) =>
  h.app.inject({ method, url: `${BASE}${url}`, headers: headers(u), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) })

async function account(u: TestUser, accountType: string, name = 'Acct'): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(u),
    payload: { name, accountType, initialBalance: '0.00' },
  })
  if (res.statusCode !== 201) throw new Error(`account failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

interface DebtBody {
  id: string; name: string; balance: string; apr: string; minimumPayment: string
  accountId: string | null; sortOrder: number; archived: boolean
  included: boolean; extraPayment: string
  repaymentStartsOn: string | null; promoApr: string | null; promoEndsOn: string | null
  promoDeferredInterest: boolean; promoInterestBase: string; compounding: string
}

async function debt(u: TestUser, over: Record<string, unknown> = {}): Promise<DebtBody> {
  const res = await req('POST', '/debts', u, {
    name: 'Visa', balance: '1000.00', apr: '12', minimumPayment: '100.00', ...over,
  })
  if (res.statusCode !== 200) throw new Error(`debt failed: ${res.statusCode} ${res.body}`)
  return res.json() as DebtBody
}

describe('debts CRUD', () => {
  it('creates, reads, updates and deletes a debt, with money as four-place strings', async () => {
    const created = await debt(user, { name: 'Card', balance: '1234.5', apr: '19.99', minimumPayment: '35' })
    expect(created).toMatchObject({
      name: 'Card', balance: '1234.5000', apr: '19.9900', minimumPayment: '35.0000',
      accountId: null, archived: false, included: true, extraPayment: '0.0000',
      repaymentStartsOn: null, promoApr: null, promoEndsOn: null,
      promoDeferredInterest: false, promoInterestBase: 'original', compounding: 'monthly',
    })

    const read = await req('GET', `/debts/${created.id}`, user)
    expect(read.statusCode).toBe(200)
    expect(read.json()).toEqual(created)

    const put = await req('PUT', `/debts/${created.id}`, user, { balance: '1000.25' })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({ name: 'Card', balance: '1000.2500', apr: '19.9900' })

    const del = await req('DELETE', `/debts/${created.id}`, user)
    expect(del.statusCode).toBe(200)
    expect(del.json()).toEqual({ removed: 1 })
    expect((await req('GET', `/debts/${created.id}`, user)).statusCode).toBe(404)
  })

  it('stores the in-plan switch and the earmark, normalised, and refuses bad ones', async () => {
    const created = await debt(user, { name: 'Earmarked', included: false, extraPayment: '25.5' })
    expect(created).toMatchObject({ included: false, extraPayment: '25.5000' })

    const put = await req('PUT', `/debts/${created.id}`, user, { included: true })
    expect(put.json()).toMatchObject({ included: true, extraPayment: '25.5000' })

    for (const payload of [{ extraPayment: '-1' }, { extraPayment: 25 }, { extraPayment: '1.23456' }, { included: 'yes' }]) {
      const res = await req('PUT', `/debts/${created.id}`, user, payload)
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
    // The database says the same thing the API does: an earmark cannot be negative.
    await expect(
      asRole(user.id, 'UPDATE plugin_debt_payoff.debts SET extra_payment = -1 WHERE id = ?::uuid', created.id),
    ).rejects.toThrow(/ck_debts_extra_payment/)
  })

  it('stores the repayment start, the promotion and the compounding, and clears them', async () => {
    const created = await debt(user, {
      name: 'Store card', repaymentStartsOn: '2027-04-10', promoApr: '0', promoEndsOn: '2027-10-10',
      promoDeferredInterest: true, promoInterestBase: 'declining', compounding: 'daily',
    })
    expect(created).toMatchObject({
      repaymentStartsOn: '2027-04-10', promoApr: '0.0000', promoEndsOn: '2027-10-10',
      promoDeferredInterest: true, promoInterestBase: 'declining', compounding: 'daily',
    })
    expect((await req('GET', `/debts/${created.id}`, user)).json()).toEqual(created)

    const cleared = await req('PUT', `/debts/${created.id}`, user, {
      repaymentStartsOn: null, promoApr: null, promoEndsOn: null, promoDeferredInterest: false,
    })
    expect(cleared.json()).toMatchObject({
      repaymentStartsOn: null, promoApr: null, promoEndsOn: null, promoDeferredInterest: false, compounding: 'daily',
    })
  })

  it('refuses half a promotion on the field, and the database says the same', async () => {
    const created = await debt(user, { name: 'Checked' })
    const half = await req('PUT', `/debts/${created.id}`, user, { promoApr: '0' })
    expect(half.statusCode).toBe(400)
    expect(half.json()).toMatchObject({ code: 'bad_promotion' })
    for (const payload of [{ repaymentStartsOn: '2027-02-30' }, { compounding: 'weekly' }, { promoDeferredInterest: true }]) {
      expect((await req('PUT', `/debts/${created.id}`, user, payload)).statusCode, JSON.stringify(payload)).toBe(400)
    }
    await expect(
      asRole(user.id, "UPDATE plugin_debt_payoff.debts SET promo_apr = 0 WHERE id = ?::uuid", created.id),
    ).rejects.toThrow(/ck_debts_promo_pair/)
  })

  it('lists in the person’s own order and hides archived debts unless asked', async () => {
    const a = await debt(other, { name: 'First' })
    const b = await debt(other, { name: 'Second' })
    await req('PUT', `/debts/${a.id}`, other, { archived: true })

    const listed = (await req('GET', '/debts', other)).json() as { debts: DebtBody[] }
    expect(listed.debts.map((d) => d.name)).toEqual(['Second'])
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder)

    const all = (await req('GET', '/debts?includeArchived=true', other)).json() as { debts: DebtBody[] }
    expect(all.debts.map((d) => d.name).sort()).toEqual(['First', 'Second'])
  })

  it('refuses invalid input with a 400 and never a 500', async () => {
    for (const payload of [
      { name: '', balance: '1', apr: '1', minimumPayment: '1' },
      { name: 'x', balance: '1,5', apr: '1', minimumPayment: '1' },
      { name: 'x', balance: '-1', apr: '1', minimumPayment: '1' },
      { name: 'x', balance: '1.23456', apr: '1', minimumPayment: '1' },
      { name: 'x', balance: '1', apr: '1', minimumPayment: '1', extra: true },
    ]) {
      const res = await req('POST', '/debts', user, payload)
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect((await req('GET', '/debts/not-a-uuid', user)).statusCode).toBe(400)
  })
})

describe('row-level security between two people', () => {
  it('never shows, changes or deletes another person’s debt', async () => {
    const mine = await debt(user, { name: 'Mine' })

    expect((await req('GET', `/debts/${mine.id}`, other)).statusCode).toBe(404)
    expect((await req('PUT', `/debts/${mine.id}`, other, { name: 'Stolen' })).statusCode).toBe(404)
    expect((await req('DELETE', `/debts/${mine.id}`, other)).statusCode).toBe(404)

    const theirs = (await req('GET', '/debts?includeArchived=true', other)).json() as { debts: DebtBody[] }
    expect(theirs.debts.map((d) => d.id)).not.toContain(mine.id)

    const still = (await req('GET', `/debts/${mine.id}`, user)).json() as DebtBody
    expect(still.name).toBe('Mine')
  })

  it('keeps the timeline fields per person', async () => {
    const mine = await debt(user, { name: 'Mine, deferred', repaymentStartsOn: '2030-01-01', compounding: 'daily_simple' })
    expect((await req('PUT', `/debts/${mine.id}`, other, { repaymentStartsOn: null, compounding: 'monthly' })).statusCode).toBe(404)
    expect(await asRole(other.id, 'SELECT id FROM plugin_debt_payoff.debts WHERE id = ?::uuid', mine.id)).toEqual([])
    const still = (await req('GET', `/debts/${mine.id}`, user)).json() as DebtBody
    expect(still).toMatchObject({ repaymentStartsOn: '2030-01-01', compounding: 'daily_simple' })
  })

  it('keeps the in-plan switch and the earmark per person', async () => {
    const mine = await debt(user, { name: 'Mine, switched', included: false, extraPayment: '40' })

    expect((await req('PUT', `/debts/${mine.id}`, other, { included: true, extraPayment: '0' })).statusCode).toBe(404)
    const rows = await asRole(other.id, 'SELECT id FROM plugin_debt_payoff.debts WHERE id = ?::uuid', mine.id)
    expect(rows).toEqual([])

    const still = (await req('GET', `/debts/${mine.id}`, user)).json() as DebtBody
    expect(still).toMatchObject({ included: false, extraPayment: '40.0000' })
    // Nor does their plan see it, as a debt or as an excluded one.
    const theirPlan = (await req('GET', '/plan?tz=UTC', other)).json() as { debts: Array<{ id: string }>; excludedDebts: Array<{ id: string }> }
    expect([...theirPlan.debts, ...theirPlan.excludedDebts].map((d) => d.id)).not.toContain(mine.id)
  })

  it('never lets one person reorder, or learn the ids of, another person’s debts', async () => {
    const who = await createUser(h)
    const rival = await createUser(h)
    const a = await debt(who, { name: 'Mine A' })
    const b = await debt(who, { name: 'Mine B' })
    const theirs = await debt(rival, { name: 'Theirs' })

    // Their ids in my list: refused as unknown, exactly as an id that does not exist is.
    const forged = await req('PUT', '/debts/order', rival, { ids: [theirs.id, b.id, a.id] })
    const missing = await req('PUT', '/debts/order', rival, { ids: [theirs.id, '00000000-0000-4000-8000-0000000000aa'] })
    expect(forged.statusCode).toBe(400)
    expect(forged.json()).toMatchObject({ code: 'unknown_debt', issues: [{ path: ['ids'] }] })
    expect(missing.json()).toMatchObject({ code: 'unknown_debt', issues: [{ path: ['ids'] }] })
    expect(forged.json().message).toBe(missing.json().message)

    // Nothing moved, for either of them.
    expect(((await req('GET', '/debts', who)).json() as { debts: DebtBody[] }).debts.map((d) => [d.name, d.sortOrder])).toEqual([['Mine A', a.sortOrder], ['Mine B', b.sortOrder]])
    expect((await req('GET', `/debts/${theirs.id}`, rival)).json()).toEqual(theirs)

    // The database itself: a statement as the other person's role-bound session touches none of my rows.
    const moved = await asRole(rival.id, 'UPDATE plugin_debt_payoff.debts SET sort_order = 99 WHERE id = ?::uuid RETURNING id', a.id)
    expect(moved).toEqual([])
    expect((await req('GET', `/debts/${a.id}`, who)).json()).toMatchObject({ sortOrder: a.sortOrder })

    // And a reorder only ever answers with the caller's own debts.
    const ok = await req('PUT', '/debts/order', who, { ids: [b.id, a.id] })
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as { debts: DebtBody[] }).debts.map((d) => d.name)).toEqual(['Mine B', 'Mine A'])
    expect(JSON.stringify(ok.json())).not.toContain(theirs.id)
    expect(((await req('GET', '/debts', rival)).json() as { debts: DebtBody[] }).debts.map((d) => d.name)).toEqual(['Theirs'])
  })

  it('refuses to link a debt to another person’s account', async () => {
    const theirsCard = await account(other, 'credit_card', 'Their card')
    const res = await req('POST', '/debts', user, {
      name: 'Sneaky', balance: '1', apr: '1', minimumPayment: '1', accountId: theirsCard,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('bad_account')
  })

  it('has the database itself refuse a cross-user account key', async () => {
    const theirsCard = await account(other, 'credit_card', 'Their card 2')
    const mine = await debt(user, { name: 'Direct' })
    // Bypass the service: even with a forged row the composite key must hold.
    await expect(
      asRole(user.id, 'UPDATE plugin_debt_payoff.debts SET account_id = ? WHERE id = ?', theirsCard, mine.id),
    ).rejects.toThrow()
  })

  it('keeps a Custom order choice per person', async () => {
    const who = await createUser(h)
    const them = await createUser(h)
    expect((await req('PUT', '/settings', who, { strategy: 'custom' })).json()).toMatchObject({ strategy: 'custom', saved: true })
    expect((await req('GET', '/settings', them)).json()).toMatchObject({ strategy: 'avalanche', saved: false })
    expect((await req('GET', '/settings', who)).json()).toMatchObject({ strategy: 'custom' })
  })

  it('keeps settings per person', async () => {
    await req('PUT', '/settings', user, { strategy: 'snowball', extraPayment: '50' })
    const mine = (await req('GET', '/settings', user)).json()
    const theirs = (await req('GET', '/settings', other)).json()
    expect(mine).toMatchObject({ strategy: 'snowball', extraPayment: '50.0000', saved: true })
    expect(theirs).toMatchObject({ strategy: 'avalanche', extraPayment: '0.0000', saved: false })
  })
})

describe('reordering debts', () => {
  const orderOf = async (u: TestUser) =>
    ((await req('GET', '/debts', u)).json() as { debts: DebtBody[] }).debts

  it('reorders every debt in one request, keeps the order, and numbers from zero', async () => {
    const who = await createUser(h)
    const a = await debt(who, { name: 'A' })
    const b = await debt(who, { name: 'B' })
    const c = await debt(who, { name: 'C' })
    const archived = await debt(who, { name: 'Old', archived: true })

    const res = await req('PUT', '/debts/order', who, { ids: [c.id, a.id, b.id] })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { debts: DebtBody[] }
    expect(body.debts.map((d) => [d.name, d.sortOrder])).toEqual([['C', 0], ['A', 1], ['B', 2]])

    // It is what a later request sees (the order is stored, not held by the page).
    expect((await orderOf(who)).map((d) => d.name)).toEqual(['C', 'A', 'B'])
    // Archived debts are left alone.
    const old = (await req('GET', `/debts/${archived.id}`, who)).json() as DebtBody
    expect(old.sortOrder).toBe(archived.sortOrder)
    // `order` is a route of its own and is never read as a debt id.
    expect((await req('GET', '/debts/order', who)).statusCode).toBe(400)
  })

  it('reverses a long list in one request', async () => {
    const who = await createUser(h)
    const ids: string[] = []
    for (let i = 0; i < 12; i += 1) ids.push((await debt(who, { name: `D${i}` })).id)
    const res = await req('PUT', '/debts/order', who, { ids: [...ids].reverse() })
    expect(res.statusCode).toBe(200)
    expect((await orderOf(who)).map((d) => d.name)).toEqual(ids.map((_, i) => `D${11 - i}`))
  })

  it('refuses a list that is not exactly the person\'s debts, on the ids field, and changes nothing', async () => {
    const who = await createUser(h)
    const a = await debt(who, { name: 'A' })
    const b = await debt(who, { name: 'B' })
    const cases: Array<[string, unknown, string]> = [
      ['a duplicate', { ids: [a.id, b.id, a.id] }, 'duplicate_debt'],
      ['a missing debt', { ids: [a.id] }, 'missing_debt'],
      ['an empty list', { ids: [] }, 'missing_debt'],
      ['an unknown debt', { ids: [a.id, b.id, '00000000-0000-4000-8000-00000000beef'] }, 'unknown_debt'],
    ]
    for (const [label, payload, code] of cases) {
      const res = await req('PUT', '/debts/order', who, payload)
      expect(res.statusCode, label).toBe(400)
      expect(res.json(), label).toMatchObject({ code, issues: [{ path: ['ids'] }] })
    }
    expect((await orderOf(who)).map((d) => d.name)).toEqual(['A', 'B'])
  })

  it('refuses a malformed body with a 400 and never a 500', async () => {
    const who = await createUser(h)
    await debt(who)
    for (const payload of [{}, { ids: 'x' }, { ids: ['not-a-uuid'] }, { ids: [1] }, { ids: [], extra: true }, null, []]) {
      const res = await req('PUT', '/debts/order', who, payload)
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
  })

  it('requires a sign-in', async () => {
    const res = await h.app.inject({ method: 'PUT', url: `${BASE}/debts/order`, payload: { ids: [] } })
    expect(res.statusCode).toBe(401)
  })
})

describe('Custom order', () => {
  it('is saved, refused when unknown at the database too, and followed by the plan', async () => {
    const who = await createUser(h)
    const small = await debt(who, { name: 'Small', balance: '200', apr: '20', minimumPayment: '25' })
    const big = await debt(who, { name: 'Big', balance: '3000', apr: '9', minimumPayment: '60' })

    expect((await req('PUT', '/settings', who, { strategy: 'custom', extraPayment: '100' })).json()).toMatchObject({ strategy: 'custom', extraPayment: '100.0000' })
    const first = (await req('GET', '/plan?tz=UTC', who)).json() as { strategy: string; order: string[]; debtFreeDate: string; totalInterest: string }
    expect(first).toMatchObject({ strategy: 'custom', order: [small.id, big.id] })

    await req('PUT', '/debts/order', who, { ids: [big.id, small.id] })
    const second = (await req('GET', '/plan?tz=UTC', who)).json() as typeof first
    expect(second).toMatchObject({ strategy: 'custom', order: [big.id, small.id] })
    expect(second.totalInterest).not.toBe(first.totalInterest)

    // A request can ask for it without saving it.
    await req('PUT', '/settings', who, { strategy: 'avalanche' })
    expect((await req('GET', '/plan?tz=UTC&strategy=custom', who)).json()).toMatchObject({ strategy: 'custom', order: [big.id, small.id] })
    expect((await req('GET', '/settings', who)).json()).toMatchObject({ strategy: 'avalanche' })

    await expect(
      asRole(who.id, "UPDATE plugin_debt_payoff.plan_settings SET strategy = 'random' WHERE user_id = core.current_user_id()"),
    ).rejects.toThrow(/ck_plan_settings_strategy/)
  })

  it('leaves snowball and avalanche plans as they were for a person whose debts are in any order', async () => {
    const who = await createUser(h)
    const a = await debt(who, { name: 'A', balance: '3000', apr: '9', minimumPayment: '60' })
    const b = await debt(who, { name: 'B', balance: '200', apr: '20', minimumPayment: '25' })
    const plan = async (strategy: string) => (await req('GET', `/plan?tz=UTC&extra=50&strategy=${strategy}`, who)).json() as Record<string, unknown>
    const before = [await plan('snowball'), await plan('avalanche')]
    await req('PUT', '/debts/order', who, { ids: [b.id, a.id] })
    expect([await plan('snowball'), await plan('avalanche')]).toEqual(before)
  })
})

describe('linking a debt to an account', () => {
  it('accepts a credit card or loan, once, and refuses other kinds', async () => {
    const card = await account(user, 'credit_card', 'Link card')
    const checking = await account(user, 'checking', 'Link checking')

    const linked = await debt(user, { name: 'Linked', accountId: card })
    expect(linked.accountId).toBe(card)

    const dup = await req('POST', '/debts', user, {
      name: 'Dup', balance: '1', apr: '1', minimumPayment: '1', accountId: card,
    })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().code).toBe('account_already_linked')

    const wrongKind = await req('POST', '/debts', user, {
      name: 'Wrong', balance: '1', apr: '1', minimumPayment: '1', accountId: checking,
    })
    expect(wrongKind.statusCode).toBe(400)
    expect(wrongKind.json().code).toBe('bad_account')

    const unlinked = await req('PUT', `/debts/${linked.id}`, user, { accountId: null })
    expect((unlinked.json() as DebtBody).accountId).toBeNull()
  })

  it('suggests liability accounts and marks the ones already tracked', async () => {
    const card = await account(user, 'credit_card', 'Suggested card')
    const d = await debt(user, { name: 'Tracked', accountId: card })
    const res = await req('GET', '/account-suggestions', user)
    expect(res.statusCode).toBe(200)
    const accounts = (res.json() as { accounts: Array<{ id: string; debtId: string | null }> }).accounts
    expect(accounts.find((a) => a.id === card)?.debtId).toBe(d.id)
  })

  it('refuses a plain delete of a linked account, naming the debt', async () => {
    const card = await account(user, 'credit_card', 'Doomed card')
    await debt(user, { name: 'Survivor', accountId: card })
    const gone = await h.app.inject({ method: 'DELETE', url: `/api/v1/accounts/${card}`, headers: auth(user) })
    expect(gone.statusCode).toBe(409)
    expect(gone.json().code).toBe('account_in_use')
    expect(gone.json().message).toContain('1 debt')
  })

  it('keeps the debt, unlinked, when the account is deleted with its history', async () => {
    const card = await account(user, 'credit_card', 'History card')
    const d = await debt(user, { name: 'Kept', accountId: card })
    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${card}/delete-with-history`, headers: auth(user),
      payload: { confirmCount: 1 },
    })
    expect(res.statusCode).toBe(200)
    const after = await req('GET', `/debts/${d.id}`, user)
    expect(after.statusCode).toBe(200)
    expect((after.json() as DebtBody).accountId).toBeNull()
  })
})

describe('settings and plan', () => {
  it('computes a plan from saved settings and from explicit query values', async () => {
    const who = await createUser(h)
    await debt(who, { name: 'Big', balance: '1000', apr: '12', minimumPayment: '100' })
    await debt(who, { name: 'Small', balance: '200', apr: '20', minimumPayment: '25' })

    const plan = await req('GET', '/plan?strategy=snowball&extra=100&tz=UTC', who)
    expect(plan.statusCode).toBe(200)
    const body = plan.json() as {
      strategy: string; order: string[]; months: number; capped: boolean
      totalInterest: string; interestSaved: string | null
    }
    expect(body.strategy).toBe('snowball')
    expect(body.capped).toBe(false)
    expect(body.months).toBeGreaterThan(0)

    await req('PUT', '/settings', who, { strategy: 'avalanche', extraPayment: '100' })
    const saved = (await req('GET', '/plan?tz=UTC', who)).json() as typeof body
    expect(saved.strategy).toBe('avalanche')
  })

  it('leaves a debt that is switched out of the plan out of it, and names it', async () => {
    const who = await createUser(h)
    await debt(who, { name: 'Card', balance: '1000', apr: '12', minimumPayment: '100' })
    const mortgage = await debt(who, { name: 'Mortgage', balance: '300000', apr: '6', minimumPayment: '1800', included: false })

    const body = (await req('GET', '/plan?tz=UTC', who)).json() as {
      debts: Array<{ name: string }>; startingBalance: string; excludedDebts: Array<{ id: string; name: string }>
    }
    expect(body.debts.map((d) => d.name)).toEqual(['Card'])
    expect(body.startingBalance).toBe('1000.0000')
    expect(body.excludedDebts).toEqual([{ id: mortgage.id, name: 'Mortgage' }])
  })

  it('pays an earmark outside the pool', async () => {
    const who = await createUser(h)
    const a = await debt(who, { name: 'A', balance: '1000', apr: '0', minimumPayment: '100', extraPayment: '400' })
    await debt(who, { name: 'B', balance: '1000', apr: '0', minimumPayment: '100' })

    const body = (await req('GET', '/plan?strategy=snowball&extra=0&tz=UTC', who)).json() as {
      earmarked: string; months: number
      schedule: Array<{ payment: string }>; debts: Array<{ id: string; payoffMonth: number | null }>
    }
    expect(body.earmarked).toBe('400.0000')
    expect(body.schedule[0]?.payment).toBe('600.0000')
    expect(body.debts.find((d) => d.id === a.id)?.payoffMonth).toBe(2)
    // Its 400 stops with it: month 3 is only B, at 200.
    expect(body.schedule[2]?.payment).toBe('200.0000')
    expect(body.months).toBe(6)
  })

  it('leaves a deferred loan alone until it starts and reports a promotion', async () => {
    const who = await createUser(h)
    const loan = await debt(who, { name: 'Loan', balance: '6000', apr: '0', minimumPayment: '100', repaymentStartsOn: '2027-03-01' })
    const card = await debt(who, {
      name: 'Card', balance: '1200', apr: '24.99', minimumPayment: '25',
      promoApr: '0', promoEndsOn: '2099-01-01', promoDeferredInterest: true,
    })
    const body = (await req('GET', '/plan?strategy=avalanche&extra=0&tz=UTC', who)).json() as {
      schedule: Array<{ debts: Array<{ debtId: string; payment: string }> }>
      debts: Array<{ id: string; repaymentStartMonth: number; promo: { active: boolean; deferredInterest: boolean } | null }>
    }
    expect(body.schedule[0]?.debts.find((d) => d.debtId === loan.id)?.payment).toBe('0.0000')
    expect(body.debts.find((d) => d.id === loan.id)?.repaymentStartMonth).toBeGreaterThan(1)
    expect(body.debts.find((d) => d.id === card.id)?.promo).toMatchObject({ active: true, deferredInterest: true })
  })

  it('refuses a bad time zone or strategy', async () => {
    expect((await req('GET', '/plan?tz=Mars/Olympus', user)).statusCode).toBe(400)
    expect((await req('GET', '/plan?strategy=chaos', user)).statusCode).toBe(400)
    expect((await req('PUT', '/settings', user, { strategy: 'chaos' })).statusCode).toBe(400)
  })

  it('answers an empty plan when there are no debts', async () => {
    const who = await createUser(h)
    const res = await req('GET', '/plan?tz=UTC', who)
    expect(res.statusCode).toBe(200)
    expect((res.json() as { months: number }).months).toBe(0)
  })
})

interface LumpSumBody {
  id: string; onDate: string; amount: string; note: string
  allocations: Array<{ debtId: string; amount: string }>
}

async function lumpSum(u: TestUser, over: Record<string, unknown> = {}): Promise<LumpSumBody> {
  const res = await req('POST', '/lump-sums', u, { onDate: '2099-01-15', amount: '1500', ...over })
  if (res.statusCode !== 200) throw new Error(`lump sum failed: ${res.statusCode} ${res.body}`)
  return res.json() as LumpSumBody
}

describe('lump sums', () => {
  it('creates, lists, replaces and deletes a lump sum, with money as four-place strings', async () => {
    const who = await createUser(h)
    const created = await lumpSum(who, { onDate: '2099-03-01', amount: '2500.5', note: '  Tax refund ' })
    expect(created).toMatchObject({ onDate: '2099-03-01', amount: '2500.5000', note: 'Tax refund', allocations: [] })

    const sooner = await lumpSum(who, { onDate: '2099-02-01', amount: '10' })
    const list = await req('GET', '/lump-sums', who)
    expect(list.statusCode).toBe(200)
    expect((list.json() as { lumpSums: LumpSumBody[] }).lumpSums.map((l) => l.id)).toEqual([sooner.id, created.id])

    const put = await req('PUT', `/lump-sums/${created.id}`, who, { onDate: '2099-04-01', amount: '99.99' })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual({ id: created.id, onDate: '2099-04-01', amount: '99.9900', note: '', allocations: [] })

    const del = await req('DELETE', `/lump-sums/${created.id}`, who)
    expect(del.json()).toEqual({ removed: 1 })
    expect((await req('DELETE', `/lump-sums/${created.id}`, who)).statusCode).toBe(404)
    expect(((await req('GET', '/lump-sums', who)).json() as { lumpSums: LumpSumBody[] }).lumpSums.map((l) => l.id)).toEqual([sooner.id])
  })

  it('stores allocations aimed at the person\'s own debts and gives them back', async () => {
    const who = await createUser(h)
    const a = await debt(who, { name: 'A' })
    const b = await debt(who, { name: 'B' })
    const saved = await lumpSum(who, { amount: '1000', allocations: [{ debtId: b.id, amount: '300' }, { debtId: a.id, amount: '200.5' }] })
    expect(saved.allocations).toHaveLength(2)
    expect(saved.allocations).toEqual(expect.arrayContaining([{ debtId: a.id, amount: '200.5000' }, { debtId: b.id, amount: '300.0000' }]))
    const rows = await asRole(who.id, 'SELECT user_id FROM plugin_debt_payoff.lump_sum_allocations WHERE lump_sum_id = ?::uuid', saved.id)
    expect(rows).toEqual([{ user_id: who.id }, { user_id: who.id }])

    // A replace swaps the allocations; leaving them out clears them.
    const swapped = await req('PUT', `/lump-sums/${saved.id}`, who, { onDate: '2099-01-15', amount: '1000', allocations: [{ debtId: a.id, amount: '1000' }] })
    expect((swapped.json() as LumpSumBody).allocations).toEqual([{ debtId: a.id, amount: '1000.0000' }])
    const cleared = await req('PUT', `/lump-sums/${saved.id}`, who, { onDate: '2099-01-15', amount: '1000' })
    expect((cleared.json() as LumpSumBody).allocations).toEqual([])
  })

  it('refuses invalid input with a 400 on the field, never a 500', async () => {
    const who = await createUser(h)
    const mine = await debt(who, { name: 'Mine' })
    const bad: Array<[string, Record<string, unknown>, string]> = [
      ['no amount', { onDate: '2099-01-15' }, 'amount'],
      ['a number amount', { onDate: '2099-01-15', amount: 100 }, 'amount'],
      ['a zero amount', { onDate: '2099-01-15', amount: '0' }, 'amount'],
      ['a negative amount', { onDate: '2099-01-15', amount: '-1' }, 'amount'],
      ['too many places', { onDate: '2099-01-15', amount: '1.00001' }, 'amount'],
      ['too large', { onDate: '2099-01-15', amount: '99999999999999999' }, 'amount'],
      ['a date that does not exist', { onDate: '2099-02-30', amount: '1' }, 'onDate'],
      ['no date', { amount: '1' }, 'onDate'],
      ['a long note', { onDate: '2099-01-15', amount: '1', note: 'x'.repeat(201) }, 'note'],
      ['an unknown field', { onDate: '2099-01-15', amount: '1', color: 'red' }, ''],
      ['a forged owner', { onDate: '2099-01-15', amount: '1', userId: who.id, user_id: who.id }, ''],
      ['a bad allocation id', { onDate: '2099-01-15', amount: '1', allocations: [{ debtId: 'x', amount: '1' }] }, 'allocations'],
      ['an allocation of zero', { onDate: '2099-01-15', amount: '1', allocations: [{ debtId: mine.id, amount: '0' }] }, 'allocations'],
    ]
    for (const [label, payload, field] of bad) {
      const res = await req('POST', '/lump-sums', who, payload)
      expect(res.statusCode, label).toBe(400)
      if (field !== '') expect(res.json().issues?.[0]?.path?.[0], label).toBe(field)
    }
    for (const body of [null, 'text', [], 5]) {
      const res = await h.app.inject({ method: 'POST', url: `${BASE}/lump-sums`, headers: headers(who), payload: body as never })
      expect(res.statusCode, JSON.stringify(body)).toBeLessThan(500)
    }
    expect((await req('PUT', '/lump-sums/not-a-uuid', who, { onDate: '2099-01-15', amount: '1' })).statusCode).toBe(400)
    expect((await req('DELETE', '/lump-sums/not-a-uuid', who)).statusCode).toBe(400)
    expect(await asRole(who.id, 'SELECT id FROM plugin_debt_payoff.lump_sums')).toEqual([])
  })

  it('refuses allocations that name another person\'s debt, one twice, or add up to too much, and saves nothing', async () => {
    const who = await createUser(h)
    const rival = await createUser(h)
    const mine = await debt(who, { name: 'Mine' })
    const theirs = await debt(rival, { name: 'Theirs' })

    const forged = await req('POST', '/lump-sums', who, { onDate: '2099-01-15', amount: '100', allocations: [{ debtId: theirs.id, amount: '10' }] })
    const missing = await req('POST', '/lump-sums', who, {
      onDate: '2099-01-15', amount: '100', allocations: [{ debtId: '00000000-0000-4000-8000-0000000000aa', amount: '10' }],
    })
    expect(forged.statusCode).toBe(400)
    expect(forged.json()).toMatchObject({ code: 'unknown_debt', issues: [{ path: ['allocations', 0, 'debtId'] }] })
    // Answered exactly as an id that does not exist is, so it teaches nothing about another person's ids.
    expect(forged.json().message).toBe(missing.json().message)

    const twice = await req('POST', '/lump-sums', who, { onDate: '2099-01-15', amount: '100', allocations: [{ debtId: mine.id, amount: '10' }, { debtId: mine.id, amount: '10' }] })
    expect(twice.json()).toMatchObject({ code: 'duplicate_debt' })
    const tooMuch = await req('POST', '/lump-sums', who, { onDate: '2099-01-15', amount: '100', allocations: [{ debtId: mine.id, amount: '100.0001' }] })
    expect(tooMuch.json()).toMatchObject({ code: 'allocation_too_large', issues: [{ path: ['allocations'] }] })
    expect(await asRole(who.id, 'SELECT id FROM plugin_debt_payoff.lump_sums')).toEqual([])
    expect(await asRole(rival.id, 'SELECT lump_sum_id FROM plugin_debt_payoff.lump_sum_allocations')).toEqual([])
  })

  it('has the database itself refuse an allocation that names another person\'s debt or lump sum', async () => {
    const who = await createUser(h)
    const rival = await createUser(h)
    const mine = await debt(who, { name: 'Mine' })
    const theirs = await debt(rival, { name: 'Theirs' })
    const myLump = await lumpSum(who)
    const theirLump = await lumpSum(rival)
    const insert = (userId: string, lumpId: string, debtId: string) => asRole(
      userId,
      'INSERT INTO plugin_debt_payoff.lump_sum_allocations (lump_sum_id, user_id, debt_id, amount) VALUES (?::uuid, ?::uuid, ?::uuid, 1)',
      lumpId, userId, debtId,
    )
    // Bypassing the service: even with a forged row the composite keys hold.
    await expect(insert(who.id, myLump.id, theirs.id)).rejects.toThrow(/fk_lump_sum_allocations_debt/)
    await expect(insert(who.id, theirLump.id, mine.id)).rejects.toThrow(/fk_lump_sum_allocations_lump_sum/)
    await expect(insert(rival.id, myLump.id, theirs.id)).rejects.toThrow(/fk_lump_sum_allocations_lump_sum/)
    await insert(who.id, myLump.id, mine.id)
    await expect(insert(who.id, myLump.id, mine.id)).rejects.toThrow(/pk_lump_sum_allocations/)
    // And the database refuses a row that is not the session's own, whatever the keys say.
    await expect(asRole(
      who.id,
      "INSERT INTO plugin_debt_payoff.lump_sums (user_id, on_date, amount) VALUES (?::uuid, '2099-01-01', 1)", rival.id,
    )).rejects.toThrow(/row-level security/)
    await expect(asRole(who.id, "INSERT INTO plugin_debt_payoff.lump_sums (user_id, on_date, amount) VALUES (?::uuid, '2099-01-01', 0)", who.id))
      .rejects.toThrow(/ck_lump_sums_amount/)
  })

  it('keeps lump sums and allocations per person: never shown, changed or deleted by someone else', async () => {
    const who = await createUser(h)
    const rival = await createUser(h)
    const mine = await debt(who, { name: 'Mine' })
    const saved = await lumpSum(who, { note: 'private', allocations: [{ debtId: mine.id, amount: '5' }] })

    expect((await req('PUT', `/lump-sums/${saved.id}`, rival, { onDate: '2099-05-05', amount: '1' })).statusCode).toBe(404)
    expect((await req('DELETE', `/lump-sums/${saved.id}`, rival)).statusCode).toBe(404)
    expect(((await req('GET', '/lump-sums', rival)).json() as { lumpSums: LumpSumBody[] }).lumpSums).toEqual([])
    expect(JSON.stringify((await req('GET', '/plan?tz=UTC', rival)).json())).not.toContain('private')

    // The database: the other person's session sees, changes and deletes none of the rows, in either table.
    for (const table of ['lump_sums', 'lump_sum_allocations']) {
      expect(await asRole(rival.id, `SELECT * FROM plugin_debt_payoff.${table}`), table).toEqual([])
    }
    expect(await asRole(rival.id, "UPDATE plugin_debt_payoff.lump_sums SET amount = 99 WHERE id = ?::uuid RETURNING id", saved.id)).toEqual([])
    expect(await asRole(rival.id, 'UPDATE plugin_debt_payoff.lump_sum_allocations SET amount = 99 RETURNING lump_sum_id')).toEqual([])
    expect(await asRole(rival.id, 'DELETE FROM plugin_debt_payoff.lump_sum_allocations RETURNING lump_sum_id')).toEqual([])
    expect(await asRole(rival.id, 'DELETE FROM plugin_debt_payoff.lump_sums RETURNING id')).toEqual([])

    const still = ((await req('GET', '/lump-sums', who)).json() as { lumpSums: LumpSumBody[] }).lumpSums
    expect(still).toEqual([saved])
  })

  it('removes the parts aimed at a debt when the debt is deleted, and its lump sum stays', async () => {
    const who = await createUser(h)
    const a = await debt(who, { name: 'A' })
    const b = await debt(who, { name: 'B' })
    const saved = await lumpSum(who, { amount: '100', allocations: [{ debtId: a.id, amount: '10' }, { debtId: b.id, amount: '20' }] })
    expect((await req('DELETE', `/debts/${a.id}`, who)).statusCode).toBe(200)
    const [left] = ((await req('GET', '/lump-sums', who)).json() as { lumpSums: LumpSumBody[] }).lumpSums
    expect(left).toMatchObject({ id: saved.id, amount: '100.0000', allocations: [{ debtId: b.id, amount: '20.0000' }] })
    await req('DELETE', `/lump-sums/${saved.id}`, who)
    expect(await asRole(who.id, 'SELECT * FROM plugin_debt_payoff.lump_sum_allocations')).toEqual([])
  })

  it('applies to the plan on its date, ignores a past one with a status the page can show, and is identical without any', async () => {
    const who = await createUser(h)
    await debt(who, { name: 'Card', balance: '5000', apr: '24', minimumPayment: '150' })
    await debt(who, { name: 'Loan', balance: '8000', apr: '6', minimumPayment: '200' })
    const before = (await req('GET', '/plan?strategy=avalanche&extra=300&tz=UTC', who)).body
    expect('lumpSums' in JSON.parse(before)).toBe(false)

    const bonus = await lumpSum(who, { onDate: '2099-01-15', amount: '3000' })
    const old = await lumpSum(who, { onDate: '2000-01-01', amount: '9999' })
    const plan = (await req('GET', '/plan?strategy=avalanche&extra=300&tz=UTC', who)).json() as {
      lumpSums: Array<{ id: string; status: string; month: number | null; paid: string; unused: string }>
      totalInterest: string; months: number
    }
    expect(plan.lumpSums.find((l) => l.id === old.id)).toMatchObject({ status: 'past', month: null, paid: '0.0000', unused: '9999.0000' })
    // 2099 is past the plan's 50-year limit from 2026, so it is reported and ignored too.
    expect(plan.lumpSums.find((l) => l.id === bonus.id)).toMatchObject({ status: 'beyond_limit', month: null })

    // A lump sum inside the plan changes it; removing both brings back the exact bytes.
    await req('DELETE', `/lump-sums/${bonus.id}`, who)
    const soon = await lumpSum(who, { onDate: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10), amount: '3000' })
    const applied = (await req('GET', '/plan?strategy=avalanche&extra=300&tz=UTC', who)).json() as typeof plan
    expect(applied.lumpSums.find((l) => l.id === soon.id)).toMatchObject({ status: 'applied', paid: '3000.0000', unused: '0.0000' })
    expect(Number(applied.totalInterest)).toBeLessThan(Number(JSON.parse(before).totalInterest))
    expect(applied.months).toBeLessThan(JSON.parse(before).months)

    await req('DELETE', `/lump-sums/${soon.id}`, who)
    await req('DELETE', `/lump-sums/${old.id}`, who)
    expect((await req('GET', '/plan?strategy=avalanche&extra=300&tz=UTC', who)).body).toBe(before)
  })

  it('works under every strategy, Custom order included', async () => {
    const who = await createUser(h)
    await debt(who, { name: 'Card', balance: '5000', apr: '24', minimumPayment: '150' })
    await debt(who, { name: 'Loan', balance: '8000', apr: '6', minimumPayment: '200' })
    const on = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10)
    await lumpSum(who, { onDate: on, amount: '1000' })
    for (const strategy of ['snowball', 'avalanche', 'custom']) {
      const plan = (await req('GET', `/plan?strategy=${strategy}&extra=100&tz=UTC`, who)).json() as { lumpSums: Array<{ status: string }> }
      expect(plan.lumpSums.map((l) => l.status), strategy).toEqual(['applied'])
    }
  })

  it('previews a lump sum without saving it', async () => {
    const who = await createUser(h)
    await debt(who, { name: 'Card', balance: '5000', apr: '24', minimumPayment: '150' })
    const on = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10)
    const res = await req('POST', '/plan/what-if', who, { onDate: on, amount: '2000', strategy: 'avalanche', extra: '100', tz: 'UTC' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      current: { debtFreeDate: string; totalInterest: string }; withLumpSum: { debtFreeDate: string; totalInterest: string }
      interestSaved: string; monthsSaved: number; lumpSum: { status: string; paid: string }
    }
    expect(body.lumpSum).toMatchObject({ status: 'applied', paid: '2000.0000' })
    expect(Number(body.interestSaved)).toBeGreaterThan(0)
    expect(body.monthsSaved).toBeGreaterThan(0)
    expect(body.withLumpSum.debtFreeDate < body.current.debtFreeDate).toBe(true)
    expect(await asRole(who.id, 'SELECT id FROM plugin_debt_payoff.lump_sums')).toEqual([])

    // Saving it gives the plan the preview promised.
    await lumpSum(who, { onDate: on, amount: '2000' })
    const plan = (await req('GET', '/plan?strategy=avalanche&extra=100&tz=UTC', who)).json() as { totalInterest: string; debtFreeDate: string }
    expect(plan.totalInterest).toBe(body.withLumpSum.totalInterest)
    expect(plan.debtFreeDate).toBe(body.withLumpSum.debtFreeDate)
  })

  it('refuses a bad preview, an allocation to another person\'s debt, and a request with no sign-in', async () => {
    const who = await createUser(h)
    const rival = await createUser(h)
    const theirs = await debt(rival, { name: 'Theirs' })
    for (const payload of [
      {}, { onDate: '2099-01-15' }, { onDate: '2099-01-15', amount: 5 }, { onDate: '2099-01-15', amount: '0' },
      { onDate: '2099-01-15', amount: '5', strategy: 'chaos' }, { onDate: '2099-01-15', amount: '5', tz: 'Mars/Olympus' },
      { onDate: '2099-01-15', amount: '5', note: 'not taken' }, { onDate: '2099-01-15', amount: '5', userId: rival.id },
    ]) {
      const res = await req('POST', '/plan/what-if', who, payload)
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
    const forged = await req('POST', '/plan/what-if', who, { onDate: '2099-01-15', amount: '5', allocations: [{ debtId: theirs.id, amount: '5' }] })
    expect(forged.json()).toMatchObject({ code: 'unknown_debt' })
    const anon = await h.app.inject({ method: 'POST', url: `${BASE}/plan/what-if`, payload: { onDate: '2099-01-15', amount: '5' } })
    expect(anon.statusCode).toBe(401)
  })

  it('refuses a lump sum past the limit', async () => {
    const who = await createUser(h)
    await asPlugin(h.db, ROLE, who.id, async (trx) => {
      await sql`
        INSERT INTO plugin_debt_payoff.lump_sums (user_id, on_date, amount)
        SELECT ${who.id}::uuid, '2099-01-01', 1 FROM generate_series(1, 200)
      `.execute(trx)
    })
    const res = await req('POST', '/lump-sums', who, { onDate: '2099-01-15', amount: '1' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'too_many_lump_sums' })
  })

  it('requires a sign-in for every lump sum route', async () => {
    const id = '00000000-0000-4000-8000-000000000001'
    for (const [method, url] of [['GET', '/lump-sums'], ['POST', '/lump-sums'], ['PUT', `/lump-sums/${id}`], ['DELETE', `/lump-sums/${id}`]] as const) {
      const res = await h.app.inject({ method, url: `${BASE}${url}`, payload: method === 'GET' || method === 'DELETE' ? undefined : { onDate: '2099-01-15', amount: '1' } })
      expect(res.statusCode, `${method} ${url}`).toBe(401)
    }
  })
})

describe('the plugin role', () => {
  it('can read the granted core.accounts and its own tables', async () => {
    await expect(asRole(user.id, 'SELECT id FROM core.accounts LIMIT 1')).resolves.toBeDefined()
    await expect(asRole(user.id, 'SELECT id FROM plugin_debt_payoff.debts LIMIT 1')).resolves.toBeDefined()
    await expect(asRole(user.id, 'SELECT id FROM plugin_debt_payoff.lump_sums LIMIT 1')).resolves.toBeDefined()
    await expect(asRole(user.id, 'SELECT 1 FROM plugin_debt_payoff.lump_sum_allocations LIMIT 1')).resolves.toBeDefined()
  })

  it('cannot read core.transactions or another plugin’s tables', async () => {
    await expect(asRole(user.id, 'SELECT 1 FROM core.transactions LIMIT 1')).rejects.toThrow()
    await expect(asRole(user.id, 'SELECT 1 FROM plugin_budgets.account_lines LIMIT 1')).rejects.toThrow()
  })

  it('cannot write core.accounts', async () => {
    await expect(asRole(user.id, "UPDATE core.accounts SET name = 'x'")).rejects.toThrow()
  })
})

describe('authentication', () => {
  it('requires a sign-in', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/debts` })
    expect(res.statusCode).toBe(401)
  })
})
