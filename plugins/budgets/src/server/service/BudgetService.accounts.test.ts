import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryBudgetStore } from '../testing/InMemoryBudgetStore.js'
import { InMemoryBudgetUnitOfWork } from '../testing/InMemoryBudgetUnitOfWork.js'
import type { AccountLineInput } from './AccountLineInput.js'
import { BudgetError } from './BudgetError.js'
import { BudgetService } from './BudgetService.js'

const ALICE = 'user-alice'
const BOB = 'user-bob'
const CHECKING = 'acct-01-checking'
const SAVINGS = 'acct-02-savings'
const GIFTS = 'cat-01-gifts'
const GROCERIES = 'cat-02-groceries'

/** October 9: a third of the month has passed. */
const OCTOBER_9 = new Date('2026-10-09T12:00:00Z')

let store: InMemoryBudgetStore

function serviceAt(now: Date): BudgetService {
  return new BudgetService(new InMemoryBudgetUnitOfWork(store), () => now)
}

async function failureOf(work: Promise<unknown>): Promise<BudgetError> {
  try {
    await work
  } catch (error) {
    if (error instanceof BudgetError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

const allowance = (overrides: Partial<AccountLineInput> = {}): AccountLineInput => ({
  monthKey: '2026-10', accountId: CHECKING, planned: '150.0000', rollover: true,
  excludedCategoryIds: [GIFTS], note: null, ...overrides,
})

beforeEach(() => {
  store = new InMemoryBudgetStore()
  store.addCategory(GIFTS, 'Holiday Gifts')
  store.addCategory(GROCERIES, 'Groceries')
  store.addAccount(CHECKING, 'Joint Checking')
  store.addAccount(SAVINGS, 'Holiday Savings', 'savings')
})

describe('getMonth account lines', () => {
  it('counts everything from the account except the excluded categories', async () => {
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000', { excluded: [GIFTS] })
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-35.2500', GROCERIES)
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-03', '-12.0000', null)
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-04', '-80.0000', GIFTS)

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines).toHaveLength(1)
    expect(accountLines[0]).toMatchObject({
      accountId: CHECKING, accountName: 'Joint Checking', categoryName: 'Joint Checking spending',
      planned: '150.0000', carriedIn: '0.0000', available: '150.0000',
      spent: '47.2500', remaining: '102.7500', draft: false, health: 'on-track',
    })
  })

  it('ignores other accounts, other months and uncategorized money in', async () => {
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, SAVINGS, '2026-10-02', '-20.0000', GROCERIES)
    store.addAccountTransaction(ALICE, CHECKING, '2026-09-30', '-20.0000', GROCERIES)
    store.addAccountTransaction(ALICE, CHECKING, '2026-11-01', '-20.0000', GROCERIES)
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-01', '150.0000', null)

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines[0]).toMatchObject({ spent: '0.0000', remaining: '150.0000', health: 'unused' })
  })

  it('lets a refund in a category reduce what was spent', async () => {
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-50.0000', GROCERIES)
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-05', '20.0000', GROCERIES)

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines[0]).toMatchObject({ spent: '30.0000', remaining: '120.0000' })
  })

  it('carries what was left into the next month', async () => {
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, CHECKING, '2026-09-12', '-110.0000', GROCERIES)
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-25.0000', GROCERIES)

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines[0]).toMatchObject({
      planned: '150.0000', carriedIn: '40.0000', available: '190.0000', spent: '25.0000', remaining: '165.0000',
    })
  })

  it('carries an overspend as a negative', async () => {
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, CHECKING, '2026-09-12', '-170.0000', GROCERIES)
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines[0]).toMatchObject({ carriedIn: '-20.0000', available: '130.0000' })
  })

  it('does not carry when rollover is off', async () => {
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000', { rollover: false })
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000', { rollover: false })

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines[0]).toMatchObject({ carriedIn: '0.0000', available: '150.0000' })
  })

  it('measures each earlier month by that month\'s own exclusions', async () => {
    // September did not exclude gifts, so the gift counts against its allowance.
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000', { excluded: [] })
    store.addAccountTransaction(ALICE, CHECKING, '2026-09-12', '-100.0000', GIFTS)
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000', { excluded: [GIFTS] })

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines[0]).toMatchObject({ carriedIn: '50.0000' })
  })

  it('is judged by total, never by pace', async () => {
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    // 90% gone by the 9th would be at-risk for a category line.
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-135.0000', GROCERIES)

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')
    expect(accountLines[0]?.health).toBe('on-track')

    store.addAccountTransaction(ALICE, CHECKING, '2026-10-03', '-20.0000', GROCERIES)
    const over = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')
    expect(over.accountLines[0]).toMatchObject({ health: 'over', remaining: '-5.0000' })
  })

  it('previews last month\'s allowance as a draft, carrying nothing, without writing', async () => {
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000', { excluded: [GIFTS] })
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-10.0000', GROCERIES)

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines[0]).toMatchObject({
      id: null, draft: true, planned: '150.0000', carriedIn: '0.0000', spent: '10.0000',
      excludedCategoryIds: [GIFTS],
    })
    expect(store.writes).toBe(0)
  })

  it('is kept out of the month\'s lines, totals and unbudgeted spending', async () => {
    store.addLine(ALICE, '2026-10', GROCERIES, '300.0000')
    store.addSpend(ALICE, '2026-10', GROCERIES, '60.0000')
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-60.0000', GROCERIES)

    const month = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(month.lines.map((l) => l.categoryId)).toEqual([GROCERIES])
    expect(month.summary).toMatchObject({ planned: '300.0000', spent: '60.0000' })
    expect(month.unbudgeted).toEqual([])
  })

  it('shows only the caller\'s account lines', async () => {
    store.addAccountLine(BOB, '2026-10', CHECKING, '999.0000')

    const { accountLines } = await serviceAt(OCTOBER_9).getMonth(ALICE, '2026-10', 'UTC')

    expect(accountLines).toEqual([])
  })
})

describe('upsertAccountLine', () => {
  it('stores the line for the month', async () => {
    const saved = await serviceAt(OCTOBER_9).upsertAccountLine(ALICE, allowance())

    expect(saved).toMatchObject({ accountId: CHECKING, planned: '150.0000', rollover: true, excludedCategoryIds: [GIFTS] })
    expect(store.accountLines[0]).toMatchObject({ period_start: '2026-10-01', period_end: '2026-11-01' })
  })

  it('updates the line already there instead of adding a second', async () => {
    await serviceAt(OCTOBER_9).upsertAccountLine(ALICE, allowance())
    await serviceAt(OCTOBER_9).upsertAccountLine(ALICE, allowance({ planned: '200.0000', excludedCategoryIds: [] }))

    expect(store.accountLines).toHaveLength(1)
    expect(store.accountLines[0]).toMatchObject({ planned: '200.0000', excluded_category_ids: [] })
  })

  it('refuses an account that is not the caller\'s', async () => {
    const error = await failureOf(serviceAt(OCTOBER_9).upsertAccountLine(ALICE, allowance({ accountId: 'acct-9-nobody' })))
    expect(error).toMatchObject({ statusCode: 400, code: 'bad_account' })
    expect(store.writes).toBe(0)
  })

  it('refuses an account that is not a checking account', async () => {
    const error = await failureOf(serviceAt(OCTOBER_9).upsertAccountLine(ALICE, allowance({ accountId: SAVINGS })))
    expect(error).toMatchObject({ statusCode: 400, code: 'bad_account' })
    expect(store.writes).toBe(0)
  })

  it('refuses an excluded category that does not exist', async () => {
    const error = await failureOf(
      serviceAt(OCTOBER_9).upsertAccountLine(ALICE, allowance({ excludedCategoryIds: ['cat-9-stranger'] })),
    )
    expect(error).toMatchObject({ statusCode: 400, code: 'bad_excluded' })
    expect(store.writes).toBe(0)
  })
})

describe('deleteAccountLine', () => {
  it('removes the month\'s line', async () => {
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    await expect(serviceAt(OCTOBER_9).deleteAccountLine(ALICE, '2026-10', CHECKING)).resolves.toEqual({ removed: 1 })
    expect(store.accountLines).toHaveLength(0)
  })

  it('answers 404 for a line the caller does not have, leaving another user\'s alone', async () => {
    store.addAccountLine(BOB, '2026-10', CHECKING, '150.0000')
    const error = await failureOf(serviceAt(OCTOBER_9).deleteAccountLine(ALICE, '2026-10', CHECKING))
    expect(error).toMatchObject({ statusCode: 404, code: 'not_found' })
    expect(store.accountLines).toHaveLength(1)
  })
})

describe('adoptMonth with account lines', () => {
  it('copies the allowance with its exclusions', async () => {
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000', { excluded: [GIFTS], note: 'fun money' })

    const result = await serviceAt(OCTOBER_9).adoptMonth(ALICE, '2026-10')

    expect(result).toEqual({ created: 1, alreadyPlanned: 0 })
    expect(store.accountLines.find((l) => l.period_start === '2026-10-01')).toMatchObject({
      account_id: CHECKING, planned: '150.0000', excluded_category_ids: [GIFTS], note: 'fun money',
    })
  })

  it('copies the allowance into a month that already has its category lines', async () => {
    store.addLine(ALICE, '2026-10', GROCERIES, '300.0000')
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000')

    const result = await serviceAt(OCTOBER_9).adoptMonth(ALICE, '2026-10')

    expect(result).toEqual({ created: 1, alreadyPlanned: 0 })
    expect(store.lines).toHaveLength(1)
  })

  it('copies category lines and allowances together', async () => {
    store.addLine(ALICE, '2026-09', GROCERIES, '300.0000')
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000')

    expect(await serviceAt(OCTOBER_9).adoptMonth(ALICE, '2026-10')).toEqual({ created: 2, alreadyPlanned: 0 })
  })

  it('reports a month that already has everything as already planned', async () => {
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000')

    expect(await serviceAt(OCTOBER_9).adoptMonth(ALICE, '2026-10')).toEqual({ created: 0, alreadyPlanned: 1 })
  })

  it('still says there is nothing to copy when neither kind exists last month', async () => {
    const error = await failureOf(serviceAt(OCTOBER_9).adoptMonth(ALICE, '2026-10'))
    expect(error).toMatchObject({ statusCode: 409, code: 'nothing_to_copy' })
  })
})

describe('getAtRisk with account lines', () => {
  it('has nothing planned when the only thing set up is last month\'s allowance', async () => {
    store.addAccountLine(ALICE, '2026-09', CHECKING, '150.0000')
    expect(await serviceAt(OCTOBER_9).getAtRisk(ALICE, 'UTC')).toMatchObject({ planned: false, lines: [] })
  })

  it('shows the allowance as a tile but keeps it out of the spent-of-available summary', async () => {
    store.addLine(ALICE, '2026-10', GROCERIES, '300.0000')
    store.addSpend(ALICE, '2026-10', GROCERIES, '60.0000')
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-60.0000', GROCERIES)

    const report = await serviceAt(OCTOBER_9).getAtRisk(ALICE, 'UTC')

    expect(report).toMatchObject({ planned: true, total: 2, summary: { spent: '60.0000', available: '300.0000' } })
    expect(report.breakdown?.map((l) => l.categoryId)).toContain(`account:${CHECKING}`)
  })

  it('puts an overdrawn allowance first', async () => {
    store.addLine(ALICE, '2026-10', GROCERIES, '300.0000')
    store.addAccountLine(ALICE, '2026-10', CHECKING, '150.0000')
    store.addAccountTransaction(ALICE, CHECKING, '2026-10-02', '-160.0000', GROCERIES)

    const report = await serviceAt(OCTOBER_9).getAtRisk(ALICE, 'UTC')

    expect(report.lines[0]).toMatchObject({ categoryId: `account:${CHECKING}`, health: 'over' })
  })
})
