import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * The forecast endpoint end to end: one account's daily balance projected
 * from its recurring items, the horizon resolved against the user's today,
 * breaches read from each day's low, transfers applied to both accounts, and
 * the grants and isolation around it.
 */

let h: Harness
const URL = '/api/v1/core/recurring-items/forecast'
const asPlugin = (u: TestUser, id: string) => ({ ...auth(u), 'x-wickermoney-plugin': id })

interface Forecast {
  today: string
  horizon: string
  window: { from: string; through: string }
  accounts: { accountId: string; name: string; accountType: string }[]
  account: { accountId: string; name: string; balance: string; buffer: string; cash: boolean } | null
  days: { date: string; balance: string; low: string }[]
  stats: {
    start: string; end: string; lowest: { date: string; balance: string }
    daysBelowZero: number | null; daysBelowBuffer: number | null
    firstBelowZero: { date: string; balance: string } | null
    firstBelowBuffer: { date: string; balance: string } | null
  } | null
  entries: { name: string; date: string; kind: string; amount: string }[]
  hasItems: boolean
}

async function account(u: TestUser, payload: Record<string, unknown>): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(u), payload: { initialBalance: '0', ...payload },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

async function item(u: TestUser, payload: Record<string, unknown>): Promise<void> {
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/recurring-items', headers: auth(u), payload })
  expect(res.statusCode, res.body).toBe(201)
}

async function forecast(u: TestUser, query = '', headers = auth(u)): Promise<Forecast> {
  const res = await h.app.inject({ method: 'GET', url: `${URL}${query}`, headers })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as Forecast
}

/** The user's today as the server sees it, and a helper for days after it. */
async function clock(u: TestUser): Promise<{ today: string; plus: (n: number) => string }> {
  const { today } = (await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(u) })).json() as { today: string }
  const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  return { today, plus }
}

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('../plugins/registry.js')
  await seedBundledPlugins(h.db)
})
afterAll(async () => { await h.close() })

describe('the forecast', () => {
  it('projects one account day by day from tomorrow, reading breaches from each day\'s low', async () => {
    const u = await createUser(h)
    const checking = await account(u, { name: 'Monthly', accountType: 'checking', initialBalance: '500.00', bufferAmount: '200.00' })
    const { today, plus } = await clock(u)
    // Rent and pay on the same day: the day ends up, but dips below zero first.
    await item(u, { name: 'Rent', kind: 'bill', frequency: 'once', seriesStartDate: plus(3), legs: [{ accountId: checking, amount: '-600' }] })
    await item(u, { name: 'Pay', kind: 'income', frequency: 'once', seriesStartDate: plus(3), legs: [{ accountId: checking, amount: '1000' }] })
    await item(u, { name: 'Phone', kind: 'bill', frequency: 'once', seriesStartDate: plus(10), legs: [{ accountId: checking, amount: '-50' }] })

    const body = await forecast(u, '?horizon=30d')

    expect(body).toMatchObject({
      today, horizon: '30d', window: { from: plus(1), through: plus(30) },
      account: { accountId: checking, balance: '500.0000', buffer: '200.0000', cash: true },
      hasItems: true,
    })
    expect(body.days).toHaveLength(30)
    expect(body.days[0]).toEqual({ date: plus(1), balance: '500.0000', low: '500.0000' })
    expect(body.days[2]).toEqual({ date: plus(3), balance: '900.0000', low: '-100.0000' })
    expect(body.days.at(-1)).toEqual({ date: plus(30), balance: '850.0000', low: '850.0000' })
    expect(body.stats).toEqual({
      start: '500.0000', end: '850.0000',
      lowest: { date: plus(3), balance: '-100.0000' },
      daysBelowZero: 1, daysBelowBuffer: 1,
      firstBelowZero: { date: plus(3), balance: '-100.0000' },
      firstBelowBuffer: { date: plus(3), balance: '-100.0000' },
    })
    expect(body.entries.map((e) => [e.date, e.name, e.amount])).toEqual([
      [plus(3), 'Pay', '1000.0000'], [plus(3), 'Rent', '-600.0000'], [plus(10), 'Phone', '-50.0000'],
    ])
  })

  it.each([
    ['30d', 30], ['60d', 60], ['90d', 90],
  ] as const)('resolves %s against the server\'s today', async (horizon, length) => {
    const u = await createUser(h)
    await account(u, { name: 'Checking', accountType: 'checking' })
    const { plus } = await clock(u)
    const body = await forecast(u, `?horizon=${horizon}`)
    expect(body.window.through).toBe(plus(length))
    expect(body.days).toHaveLength(length)
  })

  it('defaults to 90 days and to the first spendable checking account', async () => {
    const u = await createUser(h)
    await account(u, { name: 'A Savings', accountType: 'savings', spendable: true })
    await account(u, { name: 'B Yearly', accountType: 'checking', spendable: false })
    const main = await account(u, { name: 'C Main', accountType: 'checking' })
    const body = await forecast(u)
    expect(body.horizon).toBe('90d')
    expect(body.account?.accountId).toBe(main)
    expect(body.accounts.map((a) => a.name)).toEqual(['A Savings', 'B Yearly', 'C Main'])
  })

  it('runs to December 31 for eoy, and six calendar months for 6m', async () => {
    const u = await createUser(h)
    await account(u, { name: 'Checking', accountType: 'checking' })
    const { today, plus } = await clock(u)
    const eoy = await forecast(u, '?horizon=eoy')
    expect(eoy.window.through).toBe(`${plus(1).slice(0, 4)}-12-31`)
    const six = await forecast(u, '?horizon=6m')
    expect(six.window.through.slice(5, 7)).toBe(String(((Number(today.slice(5, 7)) + 5) % 12) + 1).padStart(2, '0'))
  })

  it('applies a transfer to both of its accounts', async () => {
    const u = await createUser(h)
    const checking = await account(u, { name: 'Checking', accountType: 'checking', initialBalance: '1000.00' })
    const savings = await account(u, { name: 'Savings', accountType: 'savings', initialBalance: '0' })
    const { plus } = await clock(u)
    await item(u, {
      name: 'Sinking fund', kind: 'transfer', frequency: 'once', seriesStartDate: plus(5),
      legs: [{ accountId: checking, amount: '-300' }, { accountId: savings, amount: '300' }],
    })

    const out = await forecast(u, `?horizon=30d&accountId=${checking}`)
    const into = await forecast(u, `?horizon=30d&accountId=${savings}`)
    expect(out.stats?.end).toBe('700.0000')
    expect(into.stats?.end).toBe('300.0000')
    expect(out.entries[0]).toMatchObject({ name: 'Sinking fund', kind: 'transfer', amount: '-300.0000' })
    expect(into.entries[0]).toMatchObject({ name: 'Sinking fund', kind: 'transfer', amount: '300.0000' })
  })

  it('leaves overdraft and buffer out for a credit card', async () => {
    const u = await createUser(h)
    const checking = await account(u, { name: 'Checking', accountType: 'checking', initialBalance: '1000.00' })
    const card = await account(u, { name: 'Card', accountType: 'credit_card', initialBalance: '-800.00' })
    const { plus } = await clock(u)
    await item(u, {
      name: 'Card payment', kind: 'debt_payment', frequency: 'once', seriesStartDate: plus(2),
      legs: [{ accountId: checking, amount: '-800' }, { accountId: card, amount: '800' }],
    })
    const body = await forecast(u, `?horizon=30d&accountId=${card}`)
    expect(body.account?.cash).toBe(false)
    expect(body.stats).toMatchObject({
      start: '-800.0000', end: '0.0000', daysBelowZero: null, firstBelowZero: null, firstBelowBuffer: null,
    })
  })

  it('answers with no account and no days when the user has no active account', async () => {
    const u = await createUser(h)
    const body = await forecast(u)
    expect(body).toMatchObject({ accounts: [], account: null, days: [], stats: null, entries: [], hasItems: false })
  })

  it('refuses a bad horizon, a malformed id, an archived account and another user\'s account', async () => {
    const u = await createUser(h)
    const other = await createUser(h)
    const old = await account(u, { name: 'Old', accountType: 'checking' })
    await h.app.inject({ method: 'POST', url: `/api/v1/accounts/${old}/archive`, headers: auth(u) })
    const theirs = await account(other, { name: 'Theirs', accountType: 'checking' })

    const get = (q: string) => h.app.inject({ method: 'GET', url: `${URL}${q}`, headers: auth(u) })
    expect((await get('?horizon=2y')).statusCode).toBe(400)
    expect((await get('?accountId=not-a-uuid')).statusCode).toBe(400)
    expect((await get(`?accountId=${old}`)).statusCode).toBe(404)
    expect((await get(`?accountId=${theirs}`)).statusCode).toBe(404)
  })

  it('moves with the user\'s time zone', async () => {
    const u = await createUser(h)
    await account(u, { name: 'Checking', accountType: 'checking' })
    const zone = async (timezone: string) => {
      await h.app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers: auth(u), payload: { timezone } })
      return (await forecast(u, '?horizon=30d')).today
    }
    // 25 hours apart, so always on different dates.
    expect(await zone('Pacific/Kiritimati')).not.toBe(await zone('Pacific/Pago_Pago'))
  })
})

describe('forecast access', () => {
  it('serves the forecast plugin, through its own grants', async () => {
    const u = await createUser(h)
    await account(u, { name: 'Checking', accountType: 'checking' })
    const body = await forecast(u, '', asPlugin(u, 'wickermoney.forecast'))
    expect(body.account?.name).toBe('Checking')
  })

  it('refuses a plugin without both grants', async () => {
    const u = await createUser(h)
    const res = await h.app.inject({ method: 'GET', url: URL, headers: asPlugin(u, 'wickermoney.insights') })
    expect(res.statusCode).toBe(403)
  })

  it('needs a signed-in user', async () => {
    expect((await h.app.inject({ method: 'GET', url: URL })).statusCode).toBe(401)
  })
})
