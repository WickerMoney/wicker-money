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
      accountId: null, archived: false,
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

  it('keeps settings per person', async () => {
    await req('PUT', '/settings', user, { strategy: 'snowball', extraPayment: '50' })
    const mine = (await req('GET', '/settings', user)).json()
    const theirs = (await req('GET', '/settings', other)).json()
    expect(mine).toMatchObject({ strategy: 'snowball', extraPayment: '50.0000', saved: true })
    expect(theirs).toMatchObject({ strategy: 'avalanche', extraPayment: '0.0000', saved: false })
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

  it('refuses a bad time zone or strategy', async () => {
    expect((await req('GET', '/plan?tz=Mars/Olympus', user)).statusCode).toBe(400)
    expect((await req('GET', '/plan?strategy=chaos', user)).statusCode).toBe(400)
  })

  it('answers an empty plan when there are no debts', async () => {
    const who = await createUser(h)
    const res = await req('GET', '/plan?tz=UTC', who)
    expect(res.statusCode).toBe(200)
    expect((res.json() as { months: number }).months).toBe(0)
  })
})

describe('the plugin role', () => {
  it('can read the granted core.accounts and its own tables', async () => {
    await expect(asRole(user.id, 'SELECT id FROM core.accounts LIMIT 1')).resolves.toBeDefined()
    await expect(asRole(user.id, 'SELECT id FROM plugin_debt_payoff.debts LIMIT 1')).resolves.toBeDefined()
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
