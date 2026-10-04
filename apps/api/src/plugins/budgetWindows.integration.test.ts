import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * Windows: one budget line funded once and spent down over a date range that
 * crosses months (holiday gifts, October 1 through December 25).
 *
 * Every case here runs against real PostgreSQL. The exclusion constraint that
 * keeps a window and a monthly line from double-counting the same day exists
 * only in the database, so a fake could not prove it.
 */

const PLUGIN = 'wickermoney.budgets'
const BASE = `/api/v1/p/${PLUGIN}`

let h: Harness
let user: TestUser
let other: TestUser
let accountId: string
let gifts: string
let groceries: string
let travel: string
let otherGifts: string

const headers = (u: TestUser) => ({ ...auth(u), 'x-wickermoney-plugin': PLUGIN })

async function newCategory(u: TestUser, name: string, slug: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(u), payload: { name, slug },
  })
  if (res.statusCode !== 201) throw new Error(`category failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

async function spend(categoryId: string, amount: string, date: string): Promise<void> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(user),
    payload: { accountId, merchant: 'SHOP', amount, transactionDate: date, categoryId },
  })
  if (res.statusCode !== 201) throw new Error(`transaction failed: ${res.statusCode} ${res.body}`)
}

async function putWindow(payload: Record<string, unknown>, u = user) {
  return h.app.inject({ method: 'PUT', url: `${BASE}/window`, headers: headers(u), payload })
}

async function putLine(payload: Record<string, unknown>, u = user) {
  return h.app.inject({ method: 'PUT', url: `${BASE}/line`, headers: headers(u), payload })
}

interface WindowFigures { start: string; through: string; funded: string; spentToDate: string }

interface Line {
  id: string | null; categoryId: string; planned: string; carriedIn: string; available: string
  spent: string; remaining: string; rollover: boolean; health: string; used: number; elapsed: number
  draft: boolean; window: WindowFigures | null
}

interface MonthBody {
  draft: boolean
  lines: Line[]
  unbudgeted: Array<{ categoryId: string; spent: string }>
  summary: { planned: string; available: string; spent: string; remaining: string; unbudgetedSpent: string }
}

async function month(key: string, u = user): Promise<MonthBody> {
  const res = await h.app.inject({
    method: 'GET', url: `${BASE}/month?month=${key}&tz=UTC`, headers: headers(u),
  })
  if (res.statusCode !== 200) throw new Error(`month failed: ${res.statusCode} ${res.body}`)
  return res.json() as MonthBody
}

const lineFor = (body: MonthBody, categoryId: string) => body.lines.find((l) => l.categoryId === categoryId)
const codeOf = (res: { json: () => unknown }) => (res.json() as { code: string }).code

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('./registry.js')
  await seedBundledPlugins(h.db)

  user = await createUser(h)
  other = await createUser(h)

  const acc = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name: 'Holiday checking', accountType: 'checking', openingBalance: '0.00' },
  })
  accountId = (acc.json() as { id: string }).id

  gifts = await newCategory(user, 'Gifts', 'gifts')
  groceries = await newCategory(user, 'Groceries', 'groceries')
  travel = await newCategory(user, 'Travel', 'travel')
  otherGifts = await newCategory(other, 'Gifts', 'gifts')
})
afterAll(async () => { await h.close() })

describe('a holiday window, October 1 through December 25', () => {
  let windowId: string

  beforeAll(async () => {
    const res = await putWindow({
      categoryId: gifts, start: '2030-10-01', through: '2030-12-25', planned: '1500.0000', note: 'Christmas',
    })
    expect(res.statusCode).toBe(200)
    windowId = (res.json() as { id: string }).id
    expect(res.json()).toMatchObject({
      categoryId: gifts, start: '2030-10-01', through: '2030-12-25', planned: '1500.0000',
    })

    await spend(gifts, '-25.00', '2030-09-30') // before the window: not the window's
    await spend(gifts, '-200.00', '2030-10-10')
    await spend(gifts, '-300.00', '2030-11-20')
    await spend(gifts, '-150.00', '2030-12-05')
    await spend(gifts, '20.00', '2030-12-06') // a return comes back to the pot
    await spend(gifts, '-40.00', '2030-12-28') // after the window: not the window's
  })

  it('funds the whole pot in the month it starts', async () => {
    const oct = lineFor(await month('2030-10'), gifts)
    expect(oct).toMatchObject({
      id: windowId, planned: '1500.0000', carriedIn: '0.0000', available: '1500.0000',
      spent: '200.0000', remaining: '1300.0000', rollover: false, draft: false,
    })
    expect(oct?.window).toEqual({
      start: '2030-10-01', through: '2030-12-25', funded: '1500.0000', spentToDate: '200.0000',
    })
  })

  it('carries what is left into later months without funding it again', async () => {
    const body = await month('2030-11')
    expect(lineFor(body, gifts)).toMatchObject({
      planned: '0.0000', carriedIn: '1300.0000', available: '1300.0000', spent: '300.0000', remaining: '1000.0000',
    })
    // The month totals count the funding once, in October, not again in November.
    expect(body.summary.planned).toBe('0.0000')
    expect(lineFor(body, gifts)?.window?.spentToDate).toBe('500.0000')
  })

  it('reports what is left by Christmas, with refunds netted and the days after the window excluded', async () => {
    const body = await month('2030-12')
    expect(lineFor(body, gifts)).toMatchObject({
      carriedIn: '1000.0000', spent: '130.0000', remaining: '870.0000',
    })
    expect(lineFor(body, gifts)?.window?.spentToDate).toBe('630.0000')
    // The gift bought on the 28th is outside every line, so it shows as unbudgeted.
    expect(body.unbudgeted).toEqual([expect.objectContaining({ categoryId: gifts, spent: '40.0000' })])
  })

  it('keeps spending before the window out of it, and reports it as unbudgeted', async () => {
    const sep = await month('2030-09')
    expect(lineFor(sep, gifts)).toBeUndefined()
    expect(sep.unbudgeted).toEqual([expect.objectContaining({ categoryId: gifts, spent: '25.0000' })])
  })

  it('does not appear in a month it does not touch', async () => {
    expect(lineFor(await month('2031-01'), gifts)).toBeUndefined()
  })

  it('judges pace over the whole window, and a past month as it stood when it closed', async () => {
    // Each month reports the same pot, so `used` is the share of the pot gone
    // by the end of that month, not the share of that month's carry-in.
    const oct = lineFor(await month('2030-10'), gifts)!
    expect(oct.used).toBeCloseTo(200 / 1500, 6)
    // 2030 is in the future, so nothing has elapsed and nothing is at risk yet.
    expect(oct.elapsed).toBe(0)
    expect(oct.health).not.toBe('at-risk')
  })

  it('refuses a monthly line for the same category in a month the window covers', async () => {
    const res = await putLine({ month: '2030-11', categoryId: gifts, planned: '100.0000', rollover: false })
    expect(res.statusCode).toBe(409)
    expect(codeOf(res)).toBe('overlaps')
  })

  it('refuses a second window that overlaps by even one day', async () => {
    const res = await putWindow({ categoryId: gifts, start: '2030-12-25', through: '2031-01-10', planned: '50.0000' })
    expect(res.statusCode).toBe(409)
    expect(codeOf(res)).toBe('overlaps')
  })

  it('allows a window for the same category that starts the day after', async () => {
    const res = await putWindow({ categoryId: gifts, start: '2030-12-26', through: '2031-02-14', planned: '80.0000' })
    expect(res.statusCode).toBe(200)
    const body = await month('2030-12')
    // Two windows for Gifts in December, one row each.
    expect(body.lines.filter((l) => l.categoryId === gifts)).toHaveLength(2)
    // The gift on the 28th now belongs to the second window, so nothing is unbudgeted.
    expect(body.unbudgeted).toEqual([])
    const second = body.lines.find((l) => l.window?.start === '2030-12-26')
    expect(second).toMatchObject({ planned: '80.0000', spent: '40.0000', remaining: '40.0000' })
  })

  it('updates the dates and the amount in place', async () => {
    const res = await putWindow({
      id: windowId, categoryId: gifts, start: '2030-10-01', through: '2030-12-24', planned: '1600.0000',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: windowId, through: '2030-12-24', planned: '1600.0000' })
    expect(lineFor(await month('2030-10'), gifts)).toMatchObject({ planned: '1600.0000', remaining: '1400.0000' })
  })

  it('is not removed by deleting a monthly line', async () => {
    const res = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=2030-11&categoryId=${gifts}`, headers: headers(user),
    })
    expect(res.statusCode).toBe(404)
    expect(lineFor(await month('2030-11'), gifts)).toBeDefined()
  })

  it('is invisible to, and cannot be changed or removed by, another user', async () => {
    expect(lineFor(await month('2030-11', other), gifts)).toBeUndefined()

    const update = await putWindow(
      { id: windowId, categoryId: otherGifts, start: '2030-10-01', through: '2030-12-24', planned: '1.0000' },
      other,
    )
    expect(update.statusCode).toBe(404)

    const del = await h.app.inject({
      method: 'DELETE', url: `${BASE}/window?id=${windowId}`, headers: headers(other),
    })
    expect(del.statusCode).toBe(404)
    expect(lineFor(await month('2030-10'), gifts)?.planned).toBe('1600.0000')
  })

  it('is in the data export with its real end date', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/settings/export', headers: auth(user) })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain(windowId)
  })

  it('removes the whole window with one delete', async () => {
    const res = await h.app.inject({ method: 'DELETE', url: `${BASE}/window?id=${windowId}`, headers: headers(user) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ removed: 1 })
    expect(lineFor(await month('2030-10'), gifts)).toBeUndefined()
    expect(lineFor(await month('2030-11'), gifts)).toBeUndefined()
  })
})

describe('a window that starts mid-month', () => {
  it('counts only spending from its first day', async () => {
    await putWindow({ categoryId: travel, start: '2032-03-15', through: '2032-05-10', planned: '600.0000' })
    await spend(travel, '-30.00', '2032-03-10')
    await spend(travel, '-70.00', '2032-03-20')

    const body = await month('2032-03')
    expect(lineFor(body, travel)).toMatchObject({ planned: '600.0000', spent: '70.0000', remaining: '530.0000' })
    expect(body.unbudgeted).toEqual([expect.objectContaining({ categoryId: travel, spent: '30.0000' })])
  })

  it('goes over, and says so, once the pot is spent', async () => {
    await spend(travel, '-600.00', '2032-04-02')
    const apr = lineFor(await month('2032-04'), travel)
    expect(apr).toMatchObject({ carriedIn: '530.0000', remaining: '-70.0000', health: 'over' })
  })
})

describe('windows and the month around them', () => {
  it('leaves a covered category out of "copy last month", and copies the rest', async () => {
    await putLine({ month: '2033-09', categoryId: groceries, planned: '400.0000', rollover: false })
    await putLine({ month: '2033-09', categoryId: gifts, planned: '50.0000', rollover: false })
    await putWindow({ categoryId: gifts, start: '2033-10-01', through: '2033-12-25', planned: '900.0000' })

    // The draft shows the window as a real line and does not propose a monthly Gifts line.
    const draft = await month('2033-10')
    expect(draft.draft).toBe(true)
    expect(draft.lines.filter((l) => l.categoryId === gifts)).toEqual([
      expect.objectContaining({ draft: false, planned: '900.0000' }),
    ])
    expect(lineFor(draft, groceries)).toMatchObject({ draft: true, planned: '400.0000' })

    const adopt = await h.app.inject({
      method: 'POST', url: `${BASE}/month/adopt`, headers: headers(user), payload: { month: '2033-10' },
    })
    expect(adopt.statusCode).toBe(200)
    expect(adopt.json()).toMatchObject({ created: 1 })

    const oct = await month('2033-10')
    expect(oct.draft).toBe(false)
    expect(oct.lines.map((l) => [l.categoryId, l.window === null]).sort()).toEqual(
      [[gifts, false], [groceries, true]].sort(),
    )
  })

  it('refuses a window over a month that already has a monthly line for the category', async () => {
    const res = await putWindow({ categoryId: groceries, start: '2033-09-15', through: '2033-11-15', planned: '1.0000' })
    expect(res.statusCode).toBe(409)
    expect(codeOf(res)).toBe('overlaps')
  })

  it('does not feed a rollover chain: the chain breaks across a window', async () => {
    await putLine({ month: '2034-01', categoryId: travel, planned: '100.0000', rollover: true })
    await putWindow({ categoryId: travel, start: '2034-02-01', through: '2034-03-31', planned: '500.0000' })
    await putLine({ month: '2034-04', categoryId: travel, planned: '100.0000', rollover: true })

    expect(lineFor(await month('2034-04'), travel)?.carriedIn).toBe('0.0000')
  })
})

describe('refusing what is not a window', () => {
  it.each([
    ['ends before it starts', { start: '2035-05-10', through: '2035-05-01' }, 'bad_window'],
    ['is exactly one calendar month', { start: '2035-05-01', through: '2035-05-31' }, 'bad_window'],
    ['is longer than 24 months', { start: '2035-01-01', through: '2037-01-01' }, 'bad_window'],
    ['has an impossible date', { start: '2035-02-30', through: '2035-03-10' }, 'bad_date'],
    ['has no end', { start: '2035-02-01' }, 'bad_date'],
  ])('refuses a window that %s', async (_, dates, code) => {
    const res = await putWindow({ categoryId: travel, planned: '10.0000', ...dates })
    expect(res.statusCode).toBe(400)
    expect(codeOf(res)).toBe(code)
  })

  it('names the date a refused window is wrong on', async () => {
    const res = await putWindow({ categoryId: travel, planned: '10.0000', start: '2035-05-01', through: '2035-05-31' })

    expect(res.json()).toMatchObject({
      code: 'bad_window',
      issues: [{
        path: ['through'],
        message: 'That window is exactly one calendar month. Add it as a normal line on that month instead.',
      }],
    })
  })

  it('refuses a numeric amount rather than coercing it', async () => {
    const res = await putWindow({ categoryId: travel, start: '2035-06-01', through: '2035-07-15', planned: 10 })
    expect(codeOf(res)).toBe('bad_planned')
  })

  it('accepts a window shorter than a month', async () => {
    const res = await putWindow({ categoryId: travel, start: '2035-06-01', through: '2035-06-14', planned: '10.0000' })
    expect(res.statusCode).toBe(200)
  })

  it('refuses a malformed id, and a monthly line\'s id', async () => {
    const bad = await h.app.inject({ method: 'DELETE', url: `${BASE}/window?id=nope`, headers: headers(user) })
    expect(codeOf(bad)).toBe('bad_id')

    const line = await putLine({ month: '2035-08', categoryId: travel, planned: '5.0000', rollover: false })
    const lineId = (line.json() as { id: string }).id
    const del = await h.app.inject({ method: 'DELETE', url: `${BASE}/window?id=${lineId}`, headers: headers(user) })
    expect(del.statusCode).toBe(404)
  })
})
