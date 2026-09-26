import { sql } from 'kysely'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { asPlugin, asUser } from '../db/client.js'
import { pluginRoleName, pluginSchemaName } from '../db/plugin-roles.js'

const PLUGIN = 'wickermoney.budgets'
const BASE = `/api/v1/p/${PLUGIN}`
const ROLE = pluginRoleName(PLUGIN)

let h: Harness
let user: TestUser
let other: TestUser
let accountId: string
let groceries: string
let carMaintenance: string
let dining: string
let otherGroceries: string

const headers = (u: TestUser) => ({ ...auth(u), 'x-wickermoney-plugin': PLUGIN })

async function newCategory(u: TestUser, name: string, slug: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/categories', headers: auth(u), payload: { name, slug },
  })
  if (res.statusCode !== 201) throw new Error(`category failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

async function spend(
  categoryId: string | null, amount: string, date: string, u = user,
): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(u),
    payload: { accountId, merchant: 'SHOP', amount, transactionDate: date, categoryId },
  })
  if (res.statusCode !== 201) throw new Error(`transaction failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { id: string }).id
}

async function putLine(payload: Record<string, unknown>, u = user) {
  return h.app.inject({ method: 'PUT', url: `${BASE}/line`, headers: headers(u), payload })
}

interface MonthBody {
  monthKey: string
  draft: boolean
  today: string
  lines: Array<{
    categoryId: string; categoryName: string; planned: string; carriedIn: string
    available: string; spent: string; remaining: string; rollover: boolean
    health: string; id: string | null; draft: boolean
  }>
  unbudgeted: Array<{ categoryName: string; spent: string }>
  summary: { planned: string; spent: string; remaining: string; unbudgetedSpent: string }
}

async function month(key: string, u = user): Promise<MonthBody> {
  const res = await h.app.inject({
    method: 'GET', url: `${BASE}/month?month=${key}&tz=UTC`, headers: headers(u),
  })
  if (res.statusCode !== 200) throw new Error(`month failed: ${res.statusCode} ${res.body}`)
  return res.json() as MonthBody
}

const lineFor = (body: MonthBody, categoryId: string) =>
  body.lines.find((l) => l.categoryId === categoryId)

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('./registry.js')
  await seedBundledPlugins(h.db)

  user = await createUser(h)
  other = await createUser(h)

  const acc = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name: 'Everyday', accountType: 'checking', openingBalance: '0.00' },
  })
  accountId = (acc.json() as { id: string }).id

  groceries = await newCategory(user, 'Groceries', 'groceries')
  carMaintenance = await newCategory(user, 'Car maintenance', 'car-maintenance')
  dining = await newCategory(user, 'Dining', 'dining')
  otherGroceries = await newCategory(other, 'Groceries', 'groceries')
})
afterAll(async () => { await h.close() })

describe('a month with no plan', () => {
  it('reports nothing rather than inventing lines', async () => {
    const body = await month('2026-01')
    expect(body.lines).toEqual([])
    expect(body.draft).toBe(true)
  })

  it('refuses a month that is not a month', async () => {
    const res = await h.app.inject({
      method: 'GET', url: `${BASE}/month?month=2026-13&tz=UTC`, headers: headers(user),
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { code: string }).code).toBe('bad_month')
  })
})

describe('planning a month', () => {
  it('creates a line and derives its figures from the ledger', async () => {
    await putLine({ month: '2026-03', categoryId: groceries, planned: '400.0000', rollover: false })
    await spend(groceries, '-120.50', '2026-03-04')

    const line = lineFor(await month('2026-03'), groceries)
    expect(line?.planned).toBe('400.0000')
    expect(line?.spent).toBe('120.5000')
    expect(line?.remaining).toBe('279.5000')
  })

  it('updates in place rather than creating a second line for the same month', async () => {
    await putLine({ month: '2026-03', categoryId: groceries, planned: '450.0000', rollover: false })

    const body = await month('2026-03')
    // A second Groceries line for March would make every total on the page
    // quietly wrong while both rows looked authoritative.
    expect(body.lines.filter((l) => l.categoryId === groceries).length).toBe(1)
    expect(lineFor(body, groceries)?.planned).toBe('450.0000')
  })

  it('keeps months apart, so a plan is per month and not forever', async () => {
    await putLine({ month: '2026-04', categoryId: groceries, planned: '300.0000', rollover: false })

    expect(lineFor(await month('2026-03'), groceries)?.planned).toBe('450.0000')
    expect(lineFor(await month('2026-04'), groceries)?.planned).toBe('300.0000')
  })

  it('counts only transactions inside the period (Q14)', async () => {
    await spend(groceries, '-99.00', '2026-04-02')

    // A predicate of `>= period_start` with no upper bound would count April's
    // spending against March.
    expect(lineFor(await month('2026-03'), groceries)?.spent).toBe('120.5000')
    expect(lineFor(await month('2026-04'), groceries)?.spent).toBe('99.0000')
  })

  it('refuses a negative plan and a numeric one', async () => {
    const negative = await putLine({
      month: '2026-03', categoryId: groceries, planned: '-10.00', rollover: false,
    })
    expect(negative.statusCode).toBe(400)

    // A float that arrived as JSON has already lost what it was going to lose;
    // accepting it would make that loss permanent.
    const numeric = await putLine({
      month: '2026-03', categoryId: groceries, planned: 400, rollover: false,
    })
    expect(numeric.statusCode).toBe(400)
  })

  it('removes a line, and refuses with 404 once it is gone', async () => {
    await putLine({ month: '2026-06', categoryId: dining, planned: '80.0000', rollover: false })

    const first = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=2026-06&categoryId=${dining}`, headers: headers(user),
    })
    expect(first.statusCode).toBe(200)
    expect((first.json() as { removed: number }).removed).toBe(1)

    const again = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=2026-06&categoryId=${dining}`, headers: headers(user),
    })
    // Nothing there is a 404 rather than a silent zero, so a wrong month shows
    // itself as an error the page can report.
    expect(again.statusCode).toBe(404)
    expect((again.json() as { code: string }).code).toBe('not_found')
  })
})

describe('the draft for an unplanned month', () => {
  it('offers the previous month without writing anything', async () => {
    const body = await month('2026-05')

    expect(body.draft).toBe(true)
    expect(lineFor(body, groceries)?.planned).toBe('300.0000')
    // Every id is null: this is a read, and a read that writes would persist
    // draft lines as a side effect of merely viewing a month.
    expect(body.lines.every((l) => l.id === null)).toBe(true)

    const again = await month('2026-05')
    expect(again.draft).toBe(true)
  })

  it('drafts the plan, never the carried balance', async () => {
    await putLine({ month: '2026-07', categoryId: carMaintenance, planned: '50.0000', rollover: true })

    const draft = await month('2026-08')
    // Drafting `available` would fold the leftover into next month's plan and
    // the month after would carry it again — the same money counted twice,
    // compounding.
    expect(lineFor(draft, carMaintenance)?.planned).toBe('50.0000')
    expect(lineFor(draft, carMaintenance)?.carriedIn).toBe('0.0000')
  })

  it('materializes the whole month on request', async () => {
    const before = await month('2026-05')
    expect(before.draft).toBe(true)

    const adopt = await h.app.inject({
      method: 'POST', url: `${BASE}/month/adopt`, headers: headers(user), payload: { month: '2026-05' },
    })
    expect((adopt.json() as { created: number }).created).toBeGreaterThan(0)

    const after = await month('2026-05')
    expect(after.draft).toBe(false)
    expect(after.lines.every((l) => l.id !== null)).toBe(true)
  })

  it('is idempotent, so a double click is not a failure', async () => {
    const again = await h.app.inject({
      method: 'POST', url: `${BASE}/month/adopt`, headers: headers(user), payload: { month: '2026-05' },
    })
    const body = again.json() as { created: number; alreadyPlanned: number }
    expect(body.created).toBe(0)
    expect(body.alreadyPlanned).toBeGreaterThan(0)
  })

  it('says so when there is nothing to copy', async () => {
    const res = await h.app.inject({
      method: 'POST', url: `${BASE}/month/adopt`, headers: headers(user), payload: { month: '2020-02' },
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { code: string }).code).toBe('nothing_to_copy')
  })

  it('copies only the caller\'s own lines', async () => {
    await putLine({ month: '2026-09', categoryId: groceries, planned: '111.0000', rollover: false })
    await putLine({ month: '2026-09', categoryId: otherGroceries, planned: '222.0000', rollover: false }, other)

    await h.app.inject({
      method: 'POST', url: `${BASE}/month/adopt`, headers: headers(user), payload: { month: '2026-10' },
    })

    const mine = await month('2026-10')
    expect(mine.lines.length).toBe(1)
    expect(lineFor(mine, groceries)?.planned).toBe('111.0000')
    // The other user's October is untouched and still a draft.
    expect((await month('2026-10', other)).draft).toBe(true)
  })
})

describe('carry-forward', () => {
  it('accumulates for a sinking fund across real months', async () => {
    await putLine({ month: '2026-11', categoryId: carMaintenance, planned: '100.0000', rollover: true })
    await putLine({ month: '2026-12', categoryId: carMaintenance, planned: '100.0000', rollover: true })
    await spend(carMaintenance, '-30.00', '2026-11-10')

    const december = lineFor(await month('2026-12'), carMaintenance)
    expect(december?.carriedIn).toBe('70.0000')
    expect(december?.available).toBe('170.0000')
  })

  it('carries overspend forward as a negative', async () => {
    await putLine({ month: '2027-01', categoryId: carMaintenance, planned: '100.0000', rollover: true })
    await spend(carMaintenance, '-500.00', '2026-12-05')

    // December had 170 available and 500 went out of it. Clamping
    // this to zero would mean overdrawing a fund costs nothing the following
    // month.
    const january = lineFor(await month('2027-01'), carMaintenance)
    expect(january?.carriedIn).toBe('-330.0000')
    expect(january?.available).toBe('-230.0000')
  })

  it('carries nothing when the line does not roll over', async () => {
    await putLine({ month: '2027-02', categoryId: dining, planned: '80.0000', rollover: false })
    await putLine({ month: '2027-03', categoryId: dining, planned: '80.0000', rollover: false })

    expect(lineFor(await month('2027-03'), dining)?.carriedIn).toBe('0.0000')
  })

  it('recomputes from history, so a late transaction corrects later months', async () => {
    const before = lineFor(await month('2026-12'), carMaintenance)?.carriedIn

    await spend(carMaintenance, '-20.00', '2026-11-28')

    // Nothing is stored, so a receipt entered against November today changes
    // December's opening balance. Persisting the carry
    // forward into the next row would overwrite the input it came from.
    expect(lineFor(await month('2026-12'), carMaintenance)?.carriedIn).not.toBe(before)
    expect(lineFor(await month('2026-12'), carMaintenance)?.carriedIn).toBe('50.0000')
  })
})

describe('what counts as spending', () => {
  it('ignores transfers between the user\'s own accounts', async () => {
    const second = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(user),
      payload: { name: 'Savings', accountType: 'savings', openingBalance: '0.00' },
    })
    const savingsId = (second.json() as { id: string }).id

    await putLine({ month: '2027-04', categoryId: groceries, planned: '100.0000', rollover: false })
    await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(user),
      payload: {
        accountId, merchant: 'TO SAVINGS', amount: '-500.00',
        transactionDate: '2027-04-03', categoryId: groceries, transferAccountId: savingsId,
      },
    })

    // Moving your own money is not spending it.
    expect(lineFor(await month('2027-04'), groceries)?.spent).toBe('0.0000')
  })

  it('lets a refund reduce the month rather than ignoring it', async () => {
    await putLine({ month: '2027-05', categoryId: groceries, planned: '100.0000', rollover: false })
    await spend(groceries, '-60.00', '2027-05-04')
    await spend(groceries, '25.00', '2027-05-06')

    // Filtering to `amount < 0` would drop the return and leave the month
    // showing 60 for something that cost 35.
    expect(lineFor(await month('2027-05'), groceries)?.spent).toBe('35.0000')
  })

  it('attributes a split transaction to each split category (Q3)', async () => {
    await putLine({ month: '2027-06', categoryId: groceries, planned: '200.0000', rollover: false })
    await putLine({ month: '2027-06', categoryId: dining, planned: '200.0000', rollover: false })

    const txn = await spend(groceries, '-100.00', '2027-06-08')
    await asUser(h.db, user.id, async (trx) => {
      await sql`
        INSERT INTO core.transaction_splits (user_id, transaction_id, amount, category_id)
        VALUES (${user.id}, ${txn}, -70.00, ${groceries}), (${user.id}, ${txn}, -30.00, ${dining})
      `.execute(trx)
    })

    const body = await month('2027-06')
    // Reading `transactions` alone would put the
    // whole 100 on Groceries and show Dining nothing. Both numbers look
    // plausible, which is what makes it dangerous.
    expect(lineFor(body, groceries)?.spent).toBe('70.0000')
    expect(lineFor(body, dining)?.spent).toBe('30.0000')
  })

  it('gives an under-split remainder back to the parent so totals reconcile', async () => {
    await putLine({ month: '2027-07', categoryId: groceries, planned: '200.0000', rollover: false })
    await putLine({ month: '2027-07', categoryId: dining, planned: '200.0000', rollover: false })

    const txn = await spend(groceries, '-100.00', '2027-07-08')
    await asUser(h.db, user.id, async (trx) => {
      await sql`
        INSERT INTO core.transaction_splits (user_id, transaction_id, amount, category_id)
        VALUES (${user.id}, ${txn}, -30.00, ${dining})
      `.execute(trx)
    })

    const body = await month('2027-07')
    expect(lineFor(body, dining)?.spent).toBe('30.0000')
    // The 70 that was not split stays with the parent. Without this the period
    // total no longer equals what left the account.
    expect(lineFor(body, groceries)?.spent).toBe('70.0000')
  })
})

describe('spending with no budget', () => {
  it('names the categories that have spend and no line', async () => {
    await putLine({ month: '2027-08', categoryId: groceries, planned: '100.0000', rollover: false })
    await spend(dining, '-42.00', '2027-08-09')

    const body = await month('2027-08')
    // Spending in a category with no line must be surfaced: otherwise an
    // unbudgeted category and an unspent one are both silence.
    expect(body.unbudgeted.map((u) => u.categoryName)).toContain('Dining')
    expect(body.summary.unbudgetedSpent).toBe('42.0000')
  })
})

describe('isolation between users', () => {
  it('shows a user only their own month', async () => {
    await putLine({ month: '2027-09', categoryId: groceries, planned: '500.0000', rollover: false }, user)

    const theirs = await month('2027-09', other)
    expect(theirs.lines.every((l) => l.categoryId !== groceries)).toBe(true)
  })

  it('REFUSES a budget line against another user\'s category', async () => {
    const res = await putLine(
      { month: '2027-10', categoryId: otherGroceries, planned: '50.0000', rollover: false },
      user,
    )

    // The composite foreign key on budget_lines, doing the job a plain
    // REFERENCES could not: PostgreSQL evaluates a foreign key with the
    // referenced table's privileges and bypasses row-level security while
    // doing it, so a single-column key would have accepted this.
    expect(res.statusCode).toBe(500)
    const audit = await asUser(h.db, user.id, async (trx) => {
      const r = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM plugin_budgets.budget_lines
        WHERE category_id = ${otherGroceries}
      `.execute(trx)
      return r.rows[0]?.n
    })
    expect(audit).toBe('0')
  })
})

describe('deleting a line that belongs to someone else', () => {
  it('is a 404 that leaves their line in place', async () => {
    await putLine({ month: '2028-01', categoryId: otherGroceries, planned: '60.0000', rollover: false }, other)

    const res = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=2028-01&categoryId=${otherGroceries}`, headers: headers(user),
    })

    expect(res.statusCode).toBe(404)
    expect((res.json() as { code: string }).code).toBe('not_found')
    expect(lineFor(await month('2028-01', other), otherGroceries)?.planned).toBe('60.0000')
  })

  it('is indistinguishable from deleting a line that never existed', async () => {
    const stranger = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=2028-02&categoryId=${otherGroceries}`, headers: headers(user),
    })
    const missing = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=2028-02&categoryId=${dining}`, headers: headers(user),
    })

    expect(stranger.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
    expect(stranger.json()).toEqual(missing.json())
  })

  it('refuses a malformed month or category', async () => {
    const badMonth = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=nope&categoryId=${dining}`, headers: headers(user),
    })
    const badCategory = await h.app.inject({
      method: 'DELETE', url: `${BASE}/line?month=2028-01&categoryId=not-a-uuid`, headers: headers(user),
    })

    expect((badMonth.json() as { code: string }).code).toBe('bad_month')
    expect((badCategory.json() as { code: string }).code).toBe('bad_category')
  })
})

/**
 * The at-risk widget decides "this month" from the server's clock, so these
 * fix `Date` to the middle of the real current month: the lines, the ledger
 * and the endpoint then agree on which month and day it is, however close to a
 * month boundary the suite runs. Users and their tokens are created first, on
 * the real clock.
 */
describe('the at-risk widget', () => {
  interface AtRiskBody {
    monthKey: string
    today: string
    planned: boolean
    total?: number
    lines: Array<{ categoryId: string; categoryName: string; health: string; available: string; remaining: string }>
    summary?: { spent: string; available: string }
  }

  interface Player { readonly u: TestUser; readonly account: string; readonly cat: (name: string) => Promise<string> }

  const atRisk = async (u: TestUser): Promise<AtRiskBody> => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/at-risk?tz=UTC`, headers: headers(u) })
    if (res.statusCode !== 200) throw new Error(`at-risk failed: ${res.statusCode} ${res.body}`)
    return res.json() as AtRiskBody
  }

  async function newPlayer(): Promise<Player> {
    const u = await createUser(h)
    const acc = await h.app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: auth(u),
      payload: { name: 'Main', accountType: 'checking', openingBalance: '0.00' },
    })
    let n = 0
    return {
      u,
      account: (acc.json() as { id: string }).id,
      cat: (name) => newCategory(u, name, `${name.toLowerCase()}-${n++}`),
    }
  }

  async function spendAs(p: Player, categoryId: string, amount: string, date: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: auth(p.u),
      payload: { accountId: p.account, merchant: 'SHOP', amount, transactionDate: date, categoryId },
    })
    if (res.statusCode !== 201) throw new Error(`transaction failed: ${res.statusCode} ${res.body}`)
  }

  /** Fixes the clock to noon on the 15th of the real current month; returns that month's and the previous month's keys and dates. */
  function fixClock(): { key: string; day: string; previousKey: string; previousDay: string } {
    const real = new Date()
    const at = (offset: number): Date => new Date(Date.UTC(real.getUTCFullYear(), real.getUTCMonth() + offset, 15, 12))
    vi.useFakeTimers({ toFake: ['Date'], now: at(0) })
    const iso = (d: Date): string => d.toISOString().slice(0, 10)
    return { key: iso(at(0)).slice(0, 7), day: iso(at(0)), previousKey: iso(at(-1)).slice(0, 7), previousDay: iso(at(-1)) }
  }

  afterEach(() => { vi.useRealTimers() })

  it('reports an unplanned month without inventing lines', async () => {
    const p = await newPlayer()
    const { key, day } = fixClock()

    expect(await atRisk(p.u)).toEqual({ monthKey: key, today: day, planned: false, lines: [] })
  })

  it('ranks lines that are over before those that are only at risk, and skips the healthy', async () => {
    const p = await newPlayer()
    const [over, risky, fine, idle] = [await p.cat('Over'), await p.cat('Risky'), await p.cat('Fine'), await p.cat('Idle')]
    const { key, day } = fixClock()
    for (const c of [over, risky, fine, idle]) {
      await putLine({ month: key, categoryId: c, planned: '100.0000', rollover: false }, p.u)
    }
    await spendAs(p, over, '-130.00', day)
    // 90% of the plan halfway through any month is well past the at-risk pace.
    await spendAs(p, risky, '-90.00', day)
    await spendAs(p, fine, '-10.00', day)

    const body = await atRisk(p.u)

    expect(body.planned).toBe(true)
    expect(body.total).toBe(4)
    expect(body.lines.map((l) => [l.categoryName, l.health])).toEqual([['Over', 'over'], ['Risky', 'at-risk']])
    expect(body.summary).toEqual({ spent: '230.0000', available: '400.0000' })
  })

  it('counts a rolled-over balance from last month as available', async () => {
    const p = await newPlayer()
    const fund = await p.cat('Fund')
    const { key, day, previousKey, previousDay } = fixClock()
    await putLine({ month: previousKey, categoryId: fund, planned: '100.0000', rollover: true }, p.u)
    await spendAs(p, fund, '-40.00', previousDay)
    await putLine({ month: key, categoryId: fund, planned: '100.0000', rollover: true }, p.u)
    await spendAs(p, fund, '-150.00', day)

    const body = await atRisk(p.u)

    // 60 carried in makes 160 available, so 150 spent leaves 10: at risk, not over.
    expect(body.lines[0]).toMatchObject({ categoryId: fund, available: '160.0000', remaining: '10.0000', health: 'at-risk' })
  })

  it('shows each user only their own lines and spending', async () => {
    const a = await newPlayer()
    const b = await newPlayer()
    const aCat = await a.cat('Alpha')
    const bCat = await b.cat('Beta')
    const { key, day } = fixClock()
    await putLine({ month: key, categoryId: aCat, planned: '10.0000', rollover: false }, a.u)
    await spendAs(a, aCat, '-500.00', day)
    await putLine({ month: key, categoryId: bCat, planned: '100.0000', rollover: false }, b.u)
    await spendAs(b, bCat, '-5.00', day)

    const forA = await atRisk(a.u)
    const forB = await atRisk(b.u)

    expect(forA.lines.map((l) => l.categoryId)).toEqual([aCat])
    expect(forB.lines).toEqual([])
    expect(forB).toMatchObject({ planned: true, total: 1, summary: { spent: '5.0000', available: '100.0000' } })
  })

  it('needs a signed-in user', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/at-risk?tz=UTC`, headers: { 'x-wickermoney-plugin': PLUGIN } })

    expect(res.statusCode).toBe(401)
  })
})

/**
 * Database-level isolation of the plugin role.
 *
 * Everything above tests that the plugin behaves. These test that it *cannot*
 * misbehave — that the refusal comes from PostgreSQL rather than from this
 * plugin's good manners. If a plugin can read a table it never asked for, then
 * `requiredTables` is documentation and the manifest is a comment.
 */
describe('the budgets PostgreSQL role', () => {
  it('can read the three tables its manifest grants', async () => {
    await expect(
      asPlugin(h.db, ROLE, user.id, async (trx) => {
        await sql`SELECT 1 FROM core.transactions LIMIT 1`.execute(trx)
        await sql`SELECT 1 FROM core.transaction_splits LIMIT 1`.execute(trx)
        await sql`SELECT 1 FROM core.categories LIMIT 1`.execute(trx)
        return true
      }),
    ).resolves.toBe(true)
  })

  it('REFUSES core.accounts, which it never asked for', async () => {
    await expect(
      asPlugin(h.db, ROLE, user.id, async (trx) =>
        sql`SELECT 1 FROM core.accounts LIMIT 1`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('REFUSES core.recurring_items, which the income-side work will need later', async () => {
    // Deliberately not granted until something uses it. A privilege held
    // "because we will want it" is a privilege nothing is checking.
    await expect(
      asPlugin(h.db, ROLE, user.id, async (trx) =>
        sql`SELECT 1 FROM core.recurring_items LIMIT 1`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('REFUSES core.users outright', async () => {
    await expect(
      asPlugin(h.db, ROLE, user.id, async (trx) =>
        sql`SELECT 1 FROM core.users LIMIT 1`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('REFUSES writing to the ledger, having asked only to read it', async () => {
    await expect(
      asPlugin(h.db, ROLE, user.id, async (trx) =>
        sql`UPDATE core.transactions SET merchant = 'HIJACKED'`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('REFUSES the other plugin\'s schema', async () => {
    // Two plugins on one database, and neither can read the other's storage.
    await expect(
      asPlugin(h.db, ROLE, user.id, async (trx) =>
        sql`SELECT 1 FROM plugin_import_csv.source_mappings LIMIT 1`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('REFUSES DDL in its own schema', async () => {
    // A plugin stores data in its schema; it does not reshape it at runtime.
    await expect(
      asPlugin(h.db, ROLE, user.id, async (trx) =>
        sql`CREATE TABLE ${sql.raw(pluginSchemaName(PLUGIN))}.sneaky (id int)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('cannot see another user\'s budget lines even as the right role', async () => {
    await putLine({ month: '2027-11', categoryId: groceries, planned: '77.0000', rollover: false }, user)

    const visible = await asPlugin(h.db, ROLE, other.id, async (trx) => {
      const r = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM plugin_budgets.budget_lines
        WHERE category_id = ${groceries}
      `.execute(trx)
      return r.rows[0]?.n
    })

    // Scoped to the other user's own category rather than counting the table:
    // `other` has lines of their own from earlier tests, so a bare count would
    // pass for the wrong reason the moment it saw one of those.
    //
    // The role is the right one; the user is not. Row-level security is the
    // second lock, and it is the one that matters when the first is correct.
    expect(visible).toBe('0')
  })
})
