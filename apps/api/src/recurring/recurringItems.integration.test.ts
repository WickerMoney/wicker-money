import { sql } from 'kysely'
import { nextOccurrence } from '@wickermoney/plugin-sdk/recurrence'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../db/client.js'
import { provisionPluginRole, pluginRoleName } from '../db/plugin-roles.js'
import { todayIn } from '../core/service/todayIn.js'
import { auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser } from '../testing/harness.js'

/**
 * The recurring items API, end to end against real PostgreSQL: CRUD with legs
 * in one request, validation, derived fields, tenant isolation, and the
 * plugin-facing core endpoints and grants.
 */

let h: Harness
let owner: Db
let alice: TestUser
let bob: TestUser
const acct = { checking: '', savings: '', card: '', archived: '', bobChecking: '' }
let categoryId = ''

interface Item {
  id: string
  name: string
  kind: string
  frequency: string
  seriesStartDate: string
  endDate: string | null
  semimonthlyDays: [number, number] | null
  categoryId: string | null
  legs: { accountId: string; amount: string }[]
  amount: string
  monthlyEquivalent: string
  nextDue: string | null
}

async function makeAccount(as: TestUser, name: string, accountType: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(as),
    payload: { name, accountType, initialBalance: '0.00' },
  })
  expect(res.statusCode).toBe(201)
  return (res.json() as { id: string }).id
}

const bill = (over: Record<string, unknown> = {}) => ({
  name: 'Rent', kind: 'bill', frequency: 'monthly', seriesStartDate: '2025-01-31',
  legs: [{ accountId: acct.checking, amount: '-1550.00' }], ...over,
})

async function create(payload: Record<string, unknown>, as = alice) {
  return h.app.inject({ method: 'POST', url: '/api/v1/recurring-items', headers: auth(as), payload })
}

async function created(payload: Record<string, unknown>, as = alice): Promise<Item> {
  const res = await create(payload, as)
  expect(res.statusCode, res.body).toBe(201)
  return res.json() as Item
}

async function list(query = '', as = alice): Promise<{ today: string; items: Item[] }> {
  const res = await h.app.inject({ method: 'GET', url: `/api/v1/recurring-items${query}`, headers: auth(as) })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
  alice = await createUser(h)
  bob = await createUser(h)
  acct.checking = await makeAccount(alice, 'Checking', 'checking')
  acct.savings = await makeAccount(alice, 'Savings', 'savings')
  acct.card = await makeAccount(alice, 'Card', 'credit_card')
  acct.archived = await makeAccount(alice, 'Old', 'checking')
  await h.app.inject({ method: 'POST', url: `/api/v1/accounts/${acct.archived}/archive`, headers: auth(alice) })
  acct.bobChecking = await makeAccount(bob, 'Bob Checking', 'checking')
  const cat = await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(alice), payload: { name: 'Rent', slug: 'rent-x' },
  })
  categoryId = (cat.json() as { id: string }).id
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('creating', () => {
  it('stores an item and its legs in one request and derives what depends on today', async () => {
    const item = await created(bill({ categoryId }))
    const { today } = await list()
    expect(item).toMatchObject({
      kind: 'bill', frequency: 'monthly', seriesStartDate: '2025-01-31', endDate: null, categoryId,
      legs: [{ accountId: acct.checking, amount: '-1550.0000' }],
      amount: '-1550.0000', monthlyEquivalent: '-1550.0000',
    })
    // Derived, not the anchor: the anchor is 20 months old.
    expect(item.nextDue).toBe(nextOccurrence({ frequency: 'monthly', seriesStartDate: '2025-01-31' }, today))
    expect(item.nextDue).not.toBe(item.seriesStartDate)
  })

  it('stores a split paycheck, a transfer, a debt payment and a semimonthly item', async () => {
    const pay = await created({
      name: 'Paycheck', kind: 'income', frequency: 'biweekly', seriesStartDate: '2026-01-02',
      legs: [{ accountId: acct.checking, amount: '300' }, { accountId: acct.savings, amount: '70' }],
    })
    expect(pay).toMatchObject({ amount: '370.0000', monthlyEquivalent: '801.6667' })

    const move = await created({
      name: 'Savings', kind: 'transfer', frequency: 'monthly', seriesStartDate: '2026-01-15',
      legs: [{ accountId: acct.savings, amount: '200' }, { accountId: acct.checking, amount: '-200' }],
    })
    // Negative leg first, so a transfer reads from → to.
    expect(move.legs.map((l) => l.accountId)).toEqual([acct.checking, acct.savings])
    expect(move.amount).toBe('200.0000')

    await created({
      name: 'Card', kind: 'debt_payment', frequency: 'monthly', seriesStartDate: '2026-01-10',
      legs: [{ accountId: acct.checking, amount: '-400' }, { accountId: acct.card, amount: '400' }],
    })
    const semi = await created({
      name: 'Retainer', kind: 'income', frequency: 'semimonthly', semimonthlyDays: [31, 15], seriesStartDate: '2026-01-01',
      legs: [{ accountId: acct.checking, amount: '450' }],
    })
    expect(semi.semimonthlyDays).toEqual([15, 31])
  })

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['a positive bill', { legs: [{ accountId: '', amount: '10' }] }, /one negative amount/],
    ['a debt payment into savings', { kind: 'debt_payment', legs: [{ accountId: 'checking', amount: '-1' }, { accountId: 'savings', amount: '1' }] }, /credit card or loan/],
    ['a category on a transfer', { kind: 'transfer', categoryId: 'category', legs: [{ accountId: 'checking', amount: '-1' }, { accountId: 'savings', amount: '1' }] }, /has no category/],
    ['an archived account', { legs: [{ accountId: 'archived', amount: '-1' }] }, /archived/],
    ["another user's account", { legs: [{ accountId: 'bobChecking', amount: '-1' }] }, /Account not found/],
    ['semimonthly days that collide in February', { frequency: 'semimonthly', semimonthlyDays: [28, 31] }, /27 or less/],
    ['an end before the start', { endDate: '2024-01-01' }, /on or after the first date/],
    ['an unknown frequency', { frequency: 'fortnightly' }, /frequency/],
    ['an unknown kind', { kind: 'expense' }, /kind/],
    ['a non-date', { seriesStartDate: '2026-02-30' }, /not on the calendar/],
    ['too many decimal places', { legs: [{ accountId: 'checking', amount: '-1.23456' }] }, /4 decimal places/],
  ])('refuses %s with a 400 that says why', async (_, over, message) => {
    // Account keys are resolved here, after beforeAll has created them.
    const resolve = (id: unknown) => (typeof id === 'string' && id in acct ? acct[id as keyof typeof acct] : id || acct.checking)
    const legs = (over['legs'] as { accountId: string; amount: string }[] | undefined)?.map((l) => ({ ...l, accountId: resolve(l.accountId) }))
    const payload = bill({ ...over, ...(legs ? { legs } : {}), ...(over['categoryId'] ? { categoryId } : {}) })
    const res = await create(payload)
    expect(res.statusCode, res.body).toBe(400)
    expect(res.json().code).toBe('validation_failed')
    expect(res.json().message).toMatch(message)
  })

  it('puts a refusal from the service on the leg it is about', async () => {
    const res = await create(bill({ legs: [{ accountId: acct.checking, amount: '0' }] }))

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      code: 'validation_failed',
      message: 'legs.0.amount: Must be more than 0.',
      issues: [{ path: ['legs', 0, 'amount'], message: 'Must be more than 0.' }],
    })
  })

  it('refuses an income item filed under an expense category', async () => {
    const res = await create({ ...bill({ kind: 'income', categoryId }), legs: [{ accountId: acct.checking, amount: '10' }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/income category/)
  })

  it('lists only the items touching one account', async () => {
    const u = await createUser(h)
    const a = await makeAccount(u, 'A', 'checking')
    const b = await makeAccount(u, 'B', 'savings')
    const onA = await created(bill({ legs: [{ accountId: a, amount: '-1' }] }), u)
    await created(bill({ legs: [{ accountId: b, amount: '-1' }] }), u)
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/recurring-items?accountId=${a}&includeEnded=true`, headers: auth(u) })
    expect((res.json() as { items: Item[] }).items.map((i) => i.id)).toEqual([onA.id])
    const bad = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items?accountId=nope', headers: auth(u) })
    expect(bad.statusCode).toBe(400)
  })

  it('refuses a category that belongs to someone else', async () => {
    const res = await create(bill({ categoryId }), bob)
    expect(res.statusCode).toBe(400)
  })
})

describe('reading', () => {
  it('lists active items with the today they were computed for, in the user\'s time zone', async () => {
    // As far from UTC as zones go: whichever wall-clock time the suite runs
    // at, these two are on different calendar days.
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      await sql`UPDATE core.users SET timezone = ${zone} WHERE id = ${alice.id}`.execute(owner)
      const { today } = await list()
      expect([todayIn(zone, new Date(Date.now() - 60_000)), todayIn(zone, new Date())]).toContain(today)
    }
    await sql`UPDATE core.users SET timezone = 'UTC' WHERE id = ${alice.id}`.execute(owner)
  })

  it('hides ended items unless asked', async () => {
    const ended = await created(bill({ name: 'Ended gym', seriesStartDate: '2025-01-01', endDate: '2025-06-01' }))
    expect(ended.nextDue).toBeNull()
    expect((await list()).items.map((i) => i.id)).not.toContain(ended.id)
    expect((await list('?includeEnded=true')).items.map((i) => i.id)).toContain(ended.id)
  })

  it('gets one item and 404s an unknown one', async () => {
    const item = await created(bill({ name: 'One' }))
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/recurring-items/${item.id}`, headers: auth(alice) })
    expect(res.json().id).toBe(item.id)
    const missing = await h.app.inject({
      method: 'GET', url: '/api/v1/recurring-items/00000000-0000-4000-8000-000000000000', headers: auth(alice),
    })
    expect(missing.statusCode).toBe(404)
  })

  it('lists occurrences in a half-open range, ordered by date', async () => {
    const u = await createUser(h)
    const checking = await makeAccount(u, 'C', 'checking')
    const savings = await makeAccount(u, 'S', 'savings')
    await created({ name: 'Rent', kind: 'bill', frequency: 'monthly', seriesStartDate: '2026-01-31', legs: [{ accountId: checking, amount: '-100' }] }, u)
    await created({ name: 'Move', kind: 'transfer', frequency: 'semimonthly', seriesStartDate: '2026-01-01', legs: [{ accountId: checking, amount: '-5' }, { accountId: savings, amount: '5' }] }, u)
    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/recurring-items/occurrences?from=2026-02-01&to=2026-03-01', headers: auth(u),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { from: string; to: string; occurrences: { date: string; name: string; legs: unknown[] }[] }
    expect(body).toMatchObject({ from: '2026-02-01', to: '2026-03-01' })
    expect(body.occurrences.map((o) => `${o.date} ${o.name}`)).toEqual(['2026-02-01 Move', '2026-02-15 Move', '2026-02-28 Rent'])
    expect(body.occurrences[0]?.legs).toHaveLength(2)

    const bad = await h.app.inject({
      method: 'GET', url: '/api/v1/recurring-items/occurrences?from=2026-01-01&to=2028-01-01', headers: auth(u),
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe('changing', () => {
  it('rewrites the item and its legs with PUT', async () => {
    const item = await created(bill({ name: 'Phone' }))
    const res = await h.app.inject({
      method: 'PUT', url: `/api/v1/recurring-items/${item.id}`, headers: auth(alice),
      payload: {
        name: 'Phones', kind: 'income', frequency: 'weekly', seriesStartDate: '2026-01-05',
        legs: [{ accountId: acct.checking, amount: '10' }, { accountId: acct.savings, amount: '5' }],
      },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ id: item.id, name: 'Phones', kind: 'income', amount: '15.0000' })
    expect((res.json() as Item).legs).toHaveLength(2)
  })

  it('ends a series on a date, and refuses a date before it starts', async () => {
    const item = await created(bill({ name: 'Streaming', seriesStartDate: '2025-03-01' }))
    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/recurring-items/${item.id}/end`, headers: auth(alice), payload: { endDate: '2025-06-01' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ endDate: '2025-06-01', nextDue: null })

    const early = await h.app.inject({
      method: 'POST', url: `/api/v1/recurring-items/${item.id}/end`, headers: auth(alice), payload: { endDate: '2025-01-01' },
    })
    expect(early.statusCode).toBe(400)
  })

  it('ends a series today when no date is given', async () => {
    const item = await created(bill({ name: 'Gym', seriesStartDate: '2025-03-01' }))
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/recurring-items/${item.id}/end`, headers: auth(alice) })
    expect(res.statusCode).toBe(200)
    expect(res.json().endDate).toBe((await list()).today)
  })

  it('deletes an item and its legs', async () => {
    const item = await created(bill({ name: 'Temp' }))
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/recurring-items/${item.id}`, headers: auth(alice) })
    expect(res.statusCode).toBe(204)
    const legs = await asUser(h.db, alice.id, (trx) =>
      trx.selectFrom('core.recurring_item_legs').select('id').where('recurring_item_id', '=', item.id).execute())
    expect(legs).toEqual([])
  })
})

describe('isolation', () => {
  it("never lists, reads, changes or deletes another user's item", async () => {
    const item = await created(bill({ name: 'Alice only' }))
    expect((await list('?includeEnded=true', bob)).items.map((i) => i.id)).not.toContain(item.id)

    const url = `/api/v1/recurring-items/${item.id}`
    expect((await h.app.inject({ method: 'GET', url, headers: auth(bob) })).statusCode).toBe(404)
    expect((await h.app.inject({
      method: 'PUT', url, headers: auth(bob),
      payload: bill({ legs: [{ accountId: acct.bobChecking, amount: '-1' }] }),
    })).statusCode).toBe(404)
    expect((await h.app.inject({ method: 'POST', url: `${url}/end`, headers: auth(bob) })).statusCode).toBe(404)
    expect((await h.app.inject({ method: 'DELETE', url, headers: auth(bob) })).statusCode).toBe(404)

    const occ = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items/occurrences', headers: auth(bob) })
    expect((occ.json() as { occurrences: { itemId: string }[] }).occurrences.map((o) => o.itemId)).not.toContain(item.id)
  })
})

describe('plugin access', () => {
  const asPlugin = (u: TestUser, id: string) => ({ ...auth(u), 'x-wickermoney-plugin': id })

  beforeAll(async () => {
    const { seedBundledPlugins } = await import('../plugins/registry.js')
    await seedBundledPlugins(h.db)
  })

  it('serves the core endpoints to the host itself', async () => {
    for (const url of ['/api/v1/core/recurring-items/list', '/api/v1/core/recurring-items/occurrences']) {
      const res = await h.app.inject({ method: 'GET', url, headers: auth(alice) })
      expect(res.statusCode, url).toBe(200)
      expect(res.json().today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('computes the upcoming outlook on the server, per checking account', async () => {
    const u = await createUser(h)
    const res0 = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Monthly Expenses', accountType: 'checking', initialBalance: '300.00', bufferAmount: '100.00' },
    })
    const monthly = (res0.json() as { id: string }).id
    const { today } = await list('', u)
    const plus = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
    await created({ name: 'Rent', kind: 'bill', frequency: 'once', seriesStartDate: plus(2), legs: [{ accountId: monthly, amount: '-250' }] }, u)
    await created({ name: 'Pay', kind: 'income', frequency: 'once', seriesStartDate: plus(4), legs: [{ accountId: monthly, amount: '1000' }] }, u)

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/core/recurring-items/upcoming', headers: auth(u) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      today,
      window: { from: plus(1), through: plus(4), payday: plus(4) },
      safeToSpend: '0.0000',
      accounts: [{ accountId: monthly, lowest: { date: plus(2), balance: '50.0000' }, headroom: '-50.0000', short: true }],
      hasItems: true,
    })
    expect((res.json() as { occurrences: { name: string }[] }).occurrences.map((o) => o.name)).toEqual(['Rent', 'Pay'])
  })

  it('names the account on every leg, including accounts the outlook does not list', async () => {
    const u = await createUser(h)
    const make = async (payload: Record<string, unknown>) => (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u), payload: { initialBalance: '0', ...payload },
    })).json() as { id: string }
    const checking = await make({ name: 'Everyday', accountType: 'checking', initialBalance: '500.00' })
    const vault = await make({ name: 'Vault', accountType: 'savings' })
    const { today } = await list('', u)
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10)
    await created({
      name: 'To the vault', kind: 'transfer', frequency: 'once', seriesStartDate: soon,
      legs: [{ accountId: checking.id, amount: '-100' }, { accountId: vault.id, amount: '100' }],
    }, u)

    // Through the widget's own role, as the plugin calls it.
    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/recurring-items/upcoming', headers: asPlugin(u, 'wickermoney.upcoming'),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      accounts: { accountId: string }[]
      occurrences: { name: string; legs: { accountId: string; accountName: string }[] }[]
    }
    // The savings account is not spendable, so the outlook does not list it; its leg still has a name.
    expect(body.accounts.map((a) => a.accountId)).toEqual([checking.id])
    const transfer = body.occurrences.find((o) => o.name === 'To the vault')
    expect(transfer?.legs.map((l) => [l.accountId, l.accountName])).toEqual(
      expect.arrayContaining([[checking.id, 'Everyday'], [vault.id, 'Vault']]),
    )
    expect(transfer?.legs).toHaveLength(2)
  })

  it('counts only spendable accounts, shows a non-spendable checking account, and serves it to the widget plugin', async () => {
    const u = await createUser(h)
    const make = async (payload: Record<string, unknown>) => (await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u), payload: { initialBalance: '0', ...payload },
    })).json() as { id: string; spendable: boolean }
    const monthly = await make({ name: 'Monthly', accountType: 'checking', initialBalance: '1000.00', bufferAmount: '100.00' })
    const yearly = await make({ name: 'Yearly', accountType: 'checking', initialBalance: '9000.00', spendable: false })
    const hysa = await make({ name: 'High Yield', accountType: 'savings', initialBalance: '500.00', spendable: true })
    await make({ name: 'Emergency Fund', accountType: 'savings', initialBalance: '50000.00' })

    // Through the upcoming plugin's own role: the column must be readable under its grant.
    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/recurring-items/upcoming', headers: asPlugin(u, 'wickermoney.upcoming'),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { safeToSpend: string; accounts: { accountId: string; counted: boolean }[] }
    expect(body.accounts.map((a) => [a.accountId, a.counted])).toEqual([
      [hysa.id, true], [monthly.id, true], [yearly.id, false],
    ])
    // 500 + (1000 − 100); neither Yearly's 9,000 nor the uncounted savings.
    expect(body.safeToSpend).toBe('1400.0000')
  })

  it('refuses the upcoming outlook to a plugin without both grants', async () => {
    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/recurring-items/upcoming', headers: asPlugin(alice, 'wickermoney.insights'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('refuses a plugin without a recurring_items grant', async () => {
    const res = await h.app.inject({
      method: 'GET', url: '/api/v1/core/recurring-items/list', headers: asPlugin(alice, 'wickermoney.insights'),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().message).toContain("'recurring_items'")
  })

  it('grants the legs and occurrences along with the items, at the same access level', async () => {
    const privileges = async (role: string) => {
      const r = await sql<{ table: string; sel: boolean; ins: boolean }>`
        SELECT t AS table,
               has_table_privilege(${role}, 'core.' || t, 'SELECT') AS sel,
               has_table_privilege(${role}, 'core.' || t, 'INSERT') AS ins
        FROM unnest(ARRAY['recurring_items', 'recurring_item_legs', 'recurring_occurrences', 'recurring_occurrence_legs']) AS t
      `.execute(owner)
      return r.rows
    }
    for (const access of ['read', 'write'] as const) {
      const id = `test.recurring-${access}`
      const role = pluginRoleName(id)
      try {
        await provisionPluginRole(owner, {
          id, name: 'Test', version: '0.0.0', sdkVersion: 0, permissions: [],
          requiredTables: [{ table: 'recurring_items', access }],
          remoteEntry: '/plugins/test/remoteEntry.js', contributes: { widgets: [], pages: [] },
        } as never)
        const write = access === 'write'
        expect(await privileges(role)).toEqual([
          { table: 'recurring_items', sel: true, ins: write },
          { table: 'recurring_item_legs', sel: true, ins: write },
          { table: 'recurring_occurrences', sel: true, ins: write },
          { table: 'recurring_occurrence_legs', sel: true, ins: write },
        ])
      } finally {
        // Undo exactly what provisioning granted, so the role can go and no
        // grant is left behind for the idempotency snapshot to trip on.
        const r = sql.raw(role)
        await sql`REVOKE ALL ON ALL TABLES IN SCHEMA core FROM ${r}`.execute(owner)
        await sql`REVOKE EXECUTE ON FUNCTION core.current_user_id() FROM ${r}`.execute(owner)
        await sql`REVOKE USAGE ON SCHEMA core FROM ${r}`.execute(owner)
        await sql`DROP ROLE IF EXISTS ${r}`.execute(owner)
      }
    }
  })
})
