import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../db/client.js'
import { withOwnerBackfillAccess } from '../db/migrations/support/index.js'
import { down, up } from '../db/migrations/027_budget_account_lines.js'
import {
  auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser,
} from '../testing/harness.js'

/**
 * Account lines: an allowance measured against one account ("$150 a month into
 * checking to spend on whatever") rather than one category.
 *
 * Every rule that matters here lives in SQL: which transactions count, how a
 * split is divided, that a transfer is not spending, and that the table keeps
 * one user's lines away from another's. A fake could not prove any of that.
 */

const PLUGIN = 'wickermoney.budgets'
const BASE = `/api/v1/p/${PLUGIN}`

let h: Harness
let owner: Db
let user: TestUser
let other: TestUser
let checking: string
let otherChecking: string
let savings: string
let groceries: string
let gifts: string
let paycheck: string
let strangersCategory: string

const headers = (u: TestUser) => ({ ...auth(u), 'x-wickermoney-plugin': PLUGIN })

async function create(u: TestUser, url: string, payload: Record<string, unknown>): Promise<{ id: string }> {
  const res = await h.app.inject({ method: 'POST', url, headers: auth(u), payload })
  if (res.statusCode !== 201) throw new Error(`${url} failed: ${res.statusCode} ${res.body}`)
  return res.json() as { id: string }
}

async function tx(
  account: string, amount: string, date: string, categoryId?: string, u: TestUser = user,
): Promise<string> {
  const row = await create(u, '/api/v1/transactions', {
    accountId: account, merchant: 'SHOP', amount, transactionDate: date,
    ...(categoryId === undefined ? {} : { categoryId }),
  })
  return row.id
}

const putLine = (payload: Record<string, unknown>, u = user) =>
  h.app.inject({ method: 'PUT', url: `${BASE}/account-line`, headers: headers(u), payload })

const delLine = (query: string, u = user) =>
  h.app.inject({ method: 'DELETE', url: `${BASE}/account-line?${query}`, headers: headers(u) })

interface AccountLine {
  id: string | null; accountId: string; accountName: string; categoryId: string; categoryName: string
  planned: string; carriedIn: string; available: string; spent: string; remaining: string
  health: string; draft: boolean; excludedCategoryIds: string[]
}

interface MonthBody {
  lines: unknown[]
  accountLines: AccountLine[]
  unbudgeted: unknown[]
  summary: { planned: string; spent: string }
}

async function month(key: string, u = user): Promise<MonthBody> {
  const res = await h.app.inject({ method: 'GET', url: `${BASE}/month?month=${key}&tz=UTC`, headers: headers(u) })
  if (res.statusCode !== 200) throw new Error(`month failed: ${res.statusCode} ${res.body}`)
  return res.json() as MonthBody
}

const lineOn = (body: MonthBody, account: string) => body.accountLines.find((l) => l.accountId === account)
const codeOf = (res: { json: () => unknown }) => (res.json() as { code: string }).code

beforeAll(async () => {
  h = await createHarness()
  const { seedBundledPlugins } = await import('./registry.js')
  await seedBundledPlugins(h.db)
  owner = createDb(TEST_ADMIN_DATABASE_URL)

  user = await createUser(h)
  other = await createUser(h)

  checking = (await create(user, '/api/v1/accounts', { name: 'Joint Checking', accountType: 'checking', openingBalance: '0.00' })).id
  savings = (await create(user, '/api/v1/accounts', { name: 'Holiday Savings', accountType: 'savings', openingBalance: '0.00' })).id
  otherChecking = (await create(other, '/api/v1/accounts', { name: 'Theirs', accountType: 'checking', openingBalance: '0.00' })).id
  groceries = (await create(user, '/api/v1/categories', { name: 'Groceries', slug: 'groceries' })).id
  gifts = (await create(user, '/api/v1/categories', { name: 'Holiday Gifts', slug: 'holiday-gifts' })).id
  paycheck = (await create(user, '/api/v1/categories', { name: 'Paycheck', slug: 'paycheck', kind: 'income' })).id
  strangersCategory = (await create(other, '/api/v1/categories', { name: 'Gifts', slug: 'gifts' })).id
})
afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('an allowance', () => {
  it('is stored for the month and reported with the account\'s name', async () => {
    const res = await putLine({
      month: '2031-03', accountId: checking, planned: '150.00', excludedCategoryIds: [gifts],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ accountId: checking, planned: '150.0000', rollover: true, excludedCategoryIds: [gifts] })

    await tx(checking, '-35.25', '2031-03-02', groceries)
    await tx(checking, '-80.00', '2031-03-04', gifts)

    expect(lineOn(await month('2031-03'), checking)).toMatchObject({
      accountName: 'Joint Checking', categoryName: 'Joint Checking spending',
      categoryId: `account:${checking}`, planned: '150.0000', spent: '35.2500', remaining: '114.7500', draft: false,
    })
  })

  it('stays out of the month\'s totals and unbudgeted spending', async () => {
    const body = await month('2031-03')
    expect(body.lines).toEqual([])
    expect(body.summary).toMatchObject({ planned: '0.0000', spent: '0.0000' })
  })
})

describe('the spending rules', () => {
  let accountId: string

  beforeAll(async () => {
    accountId = (await create(user, '/api/v1/accounts', { name: 'Rules Checking', accountType: 'checking', openingBalance: '0.00' })).id
    await putLine({ month: '2031-05', accountId, planned: '150.00', excludedCategoryIds: [gifts] })
  })

  const spent = async () => lineOn(await month('2031-05'), accountId)?.spent

  it('counts a categorized and an uncategorized outflow', async () => {
    await tx(accountId, '-35.25', '2031-05-02', groceries)
    await tx(accountId, '-12.00', '2031-05-03')
    expect(await spent()).toBe('47.2500')
  })

  it('leaves out an excluded category', async () => {
    await tx(accountId, '-80.00', '2031-05-04', gifts)
    expect(await spent()).toBe('47.2500')
  })

  it('does not count another account, or another month', async () => {
    await tx(checking, '-20.00', '2031-05-05', groceries)
    await tx(accountId, '-20.00', '2031-04-30', groceries)
    await tx(accountId, '-20.00', '2031-06-01', groceries)
    expect(await spent()).toBe('47.2500')
  })

  it('does not read an uncategorized deposit as a refund', async () => {
    await tx(accountId, '150.00', '2031-05-01')
    expect(await spent()).toBe('47.2500')
  })

  it('does not count income', async () => {
    await tx(accountId, '2000.00', '2031-05-01', paycheck)
    expect(await spent()).toBe('47.2500')
  })

  it('lets a refund in a category reduce the total', async () => {
    await tx(accountId, '10.00', '2031-05-06', groceries)
    expect(await spent()).toBe('37.2500')
  })

  it('does not count money moved to another of your accounts', async () => {
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/transactions/transfer', headers: auth(user),
      payload: { fromAccountId: accountId, toAccountId: savings, amount: '300.00', transactionDate: '2031-05-07' },
    })
    expect(res.statusCode).toBe(201)
    expect(await spent()).toBe('37.2500')
  })

  it('divides a split transaction between its parts, so an excluded part is left out', async () => {
    const parent = await tx(accountId, '-90.00', '2031-05-08', groceries)
    const put = await h.app.inject({
      method: 'PUT', url: `/api/v1/transactions/${parent}/splits`, headers: auth(user),
      payload: { splits: [
        { amount: '-60.00', categoryId: groceries },
        { amount: '-30.00', categoryId: gifts },
      ] },
    })
    expect(put.statusCode).toBe(200)
    // 37.25 + the 60.00 grocery part. The 30.00 gift part is excluded, and the
    // parent's 90.00 is not counted whole.
    expect(await spent()).toBe('97.2500')
  })
})

describe('rollover', () => {
  let accountId: string

  beforeAll(async () => {
    accountId = (await create(user, '/api/v1/accounts', { name: 'Roll Checking', accountType: 'checking', openingBalance: '0.00' })).id
    await putLine({ month: '2031-07', accountId, planned: '150.00' })
    await tx(accountId, '-110.00', '2031-07-12', groceries)
    await putLine({ month: '2031-08', accountId, planned: '150.00' })
    await tx(accountId, '-25.00', '2031-08-02', groceries)
  })

  it('carries what was not spent into the next month', async () => {
    expect(lineOn(await month('2031-08'), accountId)).toMatchObject({
      planned: '150.0000', carriedIn: '40.0000', available: '190.0000', spent: '25.0000', remaining: '165.0000',
    })
  })

  it('carries an overspend as a negative', async () => {
    await putLine({ month: '2031-09', accountId, planned: '100.00' })
    await tx(accountId, '-300.00', '2031-09-02', groceries)
    await putLine({ month: '2031-10', accountId, planned: '150.00' })
    // 100 planned + 165 carried in - 300 spent.
    expect(lineOn(await month('2031-10'), accountId)?.carriedIn).toBe('-35.0000')
  })

  it('carries nothing in either direction on a month where rollover is off', async () => {
    // As for a category line: a month that does not roll over neither receives
    // the balance before it nor passes its own on.
    await putLine({ month: '2031-08', accountId, planned: '150.00', rollover: false })
    expect(lineOn(await month('2031-08'), accountId)).toMatchObject({ carriedIn: '0.0000', available: '150.0000' })
    expect(lineOn(await month('2031-09'), accountId)?.carriedIn).toBe('0.0000')
  })
})

describe('writing a line', () => {
  it('updates the month\'s line instead of adding a second', async () => {
    const account = (await create(user, '/api/v1/accounts', { name: 'Upsert Checking', accountType: 'checking', openingBalance: '0.00' })).id
    const first = await putLine({ month: '2031-11', accountId: account, planned: '100.00' })
    const second = await putLine({ month: '2031-11', accountId: account, planned: '175.50', excludedCategoryIds: [gifts, gifts] })

    expect((second.json() as { id: string }).id).toBe((first.json() as { id: string }).id)
    expect(second.json()).toMatchObject({ planned: '175.5000', excludedCategoryIds: [gifts] })
    expect((await month('2031-11')).accountLines.filter((l) => l.accountId === account)).toHaveLength(1)
  })

  it('refuses a savings account', async () => {
    const res = await putLine({ month: '2031-03', accountId: savings, planned: '10.00' })
    expect(res.statusCode).toBe(400)
    expect(codeOf(res)).toBe('bad_account')
  })

  it('refuses another user\'s account', async () => {
    const res = await putLine({ month: '2031-03', accountId: otherChecking, planned: '10.00' })
    expect(res.statusCode).toBe(400)
    expect(codeOf(res)).toBe('bad_account')
  })

  it('refuses another user\'s category in the exclusions', async () => {
    const res = await putLine({ month: '2031-03', accountId: checking, planned: '10.00', excludedCategoryIds: [strangersCategory] })
    expect(res.statusCode).toBe(400)
    expect(codeOf(res)).toBe('bad_excluded')
  })

  it.each([
    ['a number for the amount', { planned: 150 }, 'bad_planned'],
    ['a negative amount', { planned: '-1.00' }, 'bad_planned'],
    ['a bad month', { month: '2031-13' }, 'bad_month'],
    ['an id that is not a UUID', { accountId: 'nope' }, 'bad_account'],
    ['a rollover that is not a boolean', { rollover: 'yes' }, 'bad_rollover'],
    ['exclusions that are not a list', { excludedCategoryIds: 'not-a-list' }, 'bad_excluded'],
    ['an exclusion that is not a UUID', { excludedCategoryIds: ['x'] }, 'bad_excluded'],
  ])('refuses %s', async (_label, patch, code) => {
    const res = await putLine({ month: '2031-03', accountId: checking, planned: '10.00', ...patch })
    expect(res.statusCode).toBe(400)
    expect(codeOf(res)).toBe(code)
  })
})

describe('isolation and removal', () => {
  it('keeps one user\'s lines out of another\'s month and out of their reach', async () => {
    const account = (await create(other, '/api/v1/accounts', { name: 'Private', accountType: 'checking', openingBalance: '0.00' })).id
    await putLine({ month: '2031-12', accountId: account, planned: '10.00' }, other)

    expect((await month('2031-12')).accountLines.map((l) => l.accountId)).not.toContain(account)
    const res = await delLine(`month=2031-12&accountId=${account}`)
    expect(res.statusCode).toBe(404)
    expect((await month('2031-12', other)).accountLines.map((l) => l.accountId)).toContain(account)
  })

  it('removes a line', async () => {
    const account = (await create(user, '/api/v1/accounts', { name: 'Doomed Line', accountType: 'checking', openingBalance: '0.00' })).id
    await putLine({ month: '2032-01', accountId: account, planned: '10.00' })
    const res = await delLine(`month=2032-01&accountId=${account}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ removed: 1 })
    expect(lineOn(await month('2032-01'), account)).toBeUndefined()
  })

  it('is named when the account is deleted, and goes with it when its history is deleted', async () => {
    const account = (await create(user, '/api/v1/accounts', { name: 'Closing', accountType: 'checking', openingBalance: '0.00' })).id
    await putLine({ month: '2032-02', accountId: account, planned: '10.00' })

    const refused = await h.app.inject({ method: 'DELETE', url: `/api/v1/accounts/${account}`, headers: auth(user) })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ code: 'account_in_use' })
    expect((refused.json() as { message: string }).message).toContain('1 budget allowance')

    const usage = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${account}/usage`, headers: auth(user) })
    const res = await h.app.inject({
      method: 'POST', url: `/api/v1/accounts/${account}/delete-with-history`, headers: auth(user),
      payload: { confirmCount: (usage.json() as { total: number }).total },
    })
    expect(res.statusCode).toBe(200)

    const left = await withOwnerBackfillAccess(owner, ['plugin_budgets.account_lines'], async (t) =>
      (await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM plugin_budgets.account_lines WHERE account_id = ${account}
      `.execute(t)).rows[0]?.n)
    expect(left).toBe(0)
  })
})

describe('copying a month and the dashboard', () => {
  let account: string

  beforeAll(async () => {
    account = (await create(user, '/api/v1/accounts', { name: 'Copy Checking', accountType: 'checking', openingBalance: '0.00' })).id
    await putLine({ month: '2032-04', accountId: account, planned: '150.00', excludedCategoryIds: [gifts], note: 'fun money' })
  })

  it('previews next month as a draft without writing it', async () => {
    const line = lineOn(await month('2032-05'), account)
    expect(line).toMatchObject({ id: null, draft: true, planned: '150.0000', excludedCategoryIds: [gifts] })
  })

  it('adopts the allowance with its exclusions and note', async () => {
    const res = await h.app.inject({
      method: 'POST', url: `${BASE}/month/adopt`, headers: headers(user), payload: { month: '2032-05' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { created: number }).created).toBeGreaterThanOrEqual(1)
    expect(lineOn(await month('2032-05'), account)).toMatchObject({ draft: false, excludedCategoryIds: [gifts] })
  })

  it('shows up as a tile in the dashboard breakdown', async () => {
    const now = new Date()
    const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const dash = await putLine({ month: key, accountId: account, planned: '150.00' })
    expect(dash.statusCode).toBe(200)

    const res = await h.app.inject({ method: 'GET', url: `${BASE}/at-risk?tz=UTC`, headers: headers(user) })
    const body = res.json() as { planned: boolean; breakdown?: Array<{ categoryId: string; remaining: string }> }
    expect(body.planned).toBe(true)
    expect(body.breakdown?.find((l) => l.categoryId === `account:${account}`)).toMatchObject({ remaining: '150.0000' })
  })
})

describe('migration 027', () => {
  const exists = async (db: Db | Parameters<typeof withOwnerBackfillAccess>[0]): Promise<boolean> =>
    (await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_class
      WHERE oid = to_regclass('plugin_budgets.account_lines')
    `.execute(db)).rows[0]?.n === 1

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await exists(owner)).toBe(true)
  })

  it('refuses a period that is not one calendar month', async () => {
    const attempt = async (start: string, end: string) =>
      withOwnerBackfillAccess(owner, ['plugin_budgets.account_lines'], async (t) => {
        await sql`
          INSERT INTO plugin_budgets.account_lines (user_id, account_id, period_start, period_end, planned)
          VALUES (${user.id}, ${checking}, ${start}::date, ${end}::date, 1)
        `.execute(t)
      })
    await expect(attempt('2033-01-01', '2033-03-01')).rejects.toThrow(/ck_account_lines_month/)
    await expect(attempt('2033-01-15', '2033-02-15')).rejects.toThrow(/ck_account_lines_month/)
  })

  it('refuses an account that belongs to someone else', async () => {
    const attempt = withOwnerBackfillAccess(owner, ['plugin_budgets.account_lines'], async (t) => {
      await sql`
        INSERT INTO plugin_budgets.account_lines (user_id, account_id, period_start, period_end, planned)
        VALUES (${user.id}, ${otherChecking}, '2033-01-01', '2033-02-01', 1)
      `.execute(t)
    })
    await expect(attempt).rejects.toThrow(/fk_account_lines_account_owned/)
  })

  it('drops the table on down, inside a transaction that is rolled back', async () => {
    class Rollback extends Error {}
    const run = owner.transaction().execute(async (trx) => {
      await down(trx)
      expect(await exists(trx)).toBe(false)
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await exists(owner)).toBe(true)
  })
})
