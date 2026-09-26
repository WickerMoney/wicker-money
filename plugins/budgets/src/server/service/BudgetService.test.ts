import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryBudgetStore } from '../testing/InMemoryBudgetStore.js'
import { InMemoryBudgetUnitOfWork } from '../testing/InMemoryBudgetUnitOfWork.js'
import { BudgetError } from './BudgetError.js'
import { BudgetService } from './BudgetService.js'
import type { LineInput } from './LineInput.js'

const ALICE = 'user-alice'
const BOB = 'user-bob'

const GROCERIES = 'cat-01-groceries'
const DINING = 'cat-02-dining'
const FUEL = 'cat-03-fuel'
const RENT = 'cat-04-rent'
const GYM = 'cat-05-gym'
const TRAVEL = 'cat-06-travel'
const FUN = 'cat-07-fun'

/** Halfway through a 30-day month, so a line's pace is twice its usage. */
const MID_JUNE = new Date('2026-06-15T12:00:00Z')

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

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  monthKey: '2026-06', categoryId: GROCERIES, planned: '100.0000', rollover: false, note: null,
  ...overrides,
})

beforeEach(() => {
  store = new InMemoryBudgetStore()
  store.addCategory(GROCERIES, 'Groceries')
  store.addCategory(DINING, 'Dining')
  store.addCategory(FUEL, 'Fuel')
  store.addCategory(RENT, 'Rent')
  store.addCategory(GYM, 'Gym')
  store.addCategory(TRAVEL, 'Travel')
  store.addCategory(FUN, 'Fun')
})

describe('getMonth', () => {
  it('derives available, remaining and health from the plan and the ledger', async () => {
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000')
    store.addLine(ALICE, '2026-06', DINING, '50.0000')
    store.addSpend(ALICE, '2026-06', GROCERIES, '30.0000')
    store.addSpend(ALICE, '2026-06', DINING, '60.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.draft).toBe(false)
    expect(report.today).toBe('2026-06-15')
    expect(report.period).toEqual({ start: '2026-06-01', end: '2026-07-01' })
    const groceries = report.lines.find((l) => l.categoryId === GROCERIES)
    const dining = report.lines.find((l) => l.categoryId === DINING)
    expect(groceries).toMatchObject({
      categoryName: 'Groceries', available: '100.0000', spent: '30.0000', remaining: '70.0000', health: 'ahead',
    })
    expect(dining).toMatchObject({ remaining: '-10.0000', health: 'over' })
    expect(report.summary).toMatchObject({
      planned: '150.0000', spent: '90.0000', remaining: '60.0000', overCount: 1, atRiskCount: 0,
    })
  })

  it('returns the previous month as an unsaved draft without writing', async () => {
    store.addLine(ALICE, '2026-05', GROCERIES, '300.0000', { note: 'weekly shop' })
    store.addSpend(ALICE, '2026-05', GROCERIES, '250.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.draft).toBe(true)
    expect(report.lines).toHaveLength(1)
    expect(report.lines[0]).toMatchObject({
      id: null, draft: true, planned: '300.0000', note: 'weekly shop', spent: '0.0000',
    })
    expect(store.writes).toBe(0)
    expect(store.lines).toHaveLength(1)
  })

  it('carries nothing into a draft, even from a rolling category', async () => {
    store.addLine(ALICE, '2026-05', GROCERIES, '300.0000', { rollover: true })
    store.addSpend(ALICE, '2026-05', GROCERIES, '100.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.lines[0]).toMatchObject({ carriedIn: '0.0000', available: '300.0000' })
  })

  it('is empty, and still a draft, when neither the month nor its predecessor has lines', async () => {
    store.addSpend(ALICE, '2026-06', GROCERIES, '40.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.draft).toBe(true)
    expect(report.lines).toEqual([])
    expect(report.unbudgeted).toEqual([{ categoryId: GROCERIES, categoryName: 'Groceries', spent: '40.0000' }])
    expect(report.summary).toMatchObject({ planned: '0.0000', remaining: '0.0000', unbudgetedSpent: '40.0000' })
  })

  it('replays history to carry a rolling balance in', async () => {
    store.addLine(ALICE, '2026-04', GROCERIES, '100.0000', { rollover: true })
    store.addSpend(ALICE, '2026-04', GROCERIES, '70.0000')
    store.addLine(ALICE, '2026-05', GROCERIES, '100.0000', { rollover: true })
    store.addSpend(ALICE, '2026-05', GROCERIES, '150.0000')
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000', { rollover: true })

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    // April leaves 30, May has 130 available and spends 150, leaving -20.
    expect(report.lines[0]).toMatchObject({ carriedIn: '-20.0000', available: '80.0000' })
  })

  it('does not carry across a gap in the history', async () => {
    store.addLine(ALICE, '2026-03', GROCERIES, '100.0000', { rollover: true })
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000', { rollover: true })

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.lines[0]?.carriedIn).toBe('0.0000')
  })

  it('carries across a year boundary', async () => {
    store.addLine(ALICE, '2026-12', GROCERIES, '100.0000', { rollover: true })
    store.addSpend(ALICE, '2026-12', GROCERIES, '25.0000')
    store.addLine(ALICE, '2027-01', GROCERIES, '100.0000', { rollover: true })

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2027-01', 'UTC')

    expect(report.lines[0]).toMatchObject({ carriedIn: '75.0000', available: '175.0000' })
  })

  it('lists unbudgeted spending biggest first, and leaves out refunds and unknown zero-spend', async () => {
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000')
    store.addSpend(ALICE, '2026-06', DINING, '20.0000')
    store.addSpend(ALICE, '2026-06', FUEL, '75.5000')
    store.addSpend(ALICE, '2026-06', RENT, '-15.0000')
    store.addSpend(ALICE, '2026-06', 'cat-deleted', '5.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.unbudgeted.map((u) => [u.categoryName, u.spent])).toEqual([
      ['Fuel', '75.5000'],
      ['Dining', '20.0000'],
      ['Unknown category', '5.0000'],
    ])
    expect(report.summary.unbudgetedSpent).toBe('100.5000')
  })

  it('lets a refund reduce a line below zero spent', async () => {
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000')
    store.addSpend(ALICE, '2026-06', GROCERIES, '-20.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.lines[0]).toMatchObject({ spent: '-20.0000', remaining: '120.0000' })
  })

  it('decides today in the caller\'s time zone', async () => {
    store.addLine(ALICE, '2026-07', GROCERIES, '100.0000')
    const lateJune = new Date('2026-06-30T23:30:00Z')

    const utc = await serviceAt(lateJune).getMonth(ALICE, '2026-07', 'UTC')
    const auckland = await serviceAt(lateJune).getMonth(ALICE, '2026-07', 'Pacific/Auckland')

    expect(utc.today).toBe('2026-06-30')
    expect(auckland.today).toBe('2026-07-01')
  })

  it('gives a month that has not started no pace', async () => {
    store.addLine(ALICE, '2026-08', GROCERIES, '100.0000')
    store.addSpend(ALICE, '2026-08', GROCERIES, '10.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-08', 'UTC')

    expect(report.lines[0]).toMatchObject({ pace: 0, health: 'on-track' })
  })

  it('treats a finished month as on track unless it went over', async () => {
    store.addLine(ALICE, '2026-04', GROCERIES, '100.0000')
    store.addLine(ALICE, '2026-04', DINING, '100.0000')
    store.addSpend(ALICE, '2026-04', GROCERIES, '99.0000')
    store.addSpend(ALICE, '2026-04', DINING, '101.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-04', 'UTC')

    expect(report.lines.find((l) => l.categoryId === GROCERIES)?.health).toBe('on-track')
    expect(report.lines.find((l) => l.categoryId === DINING)?.health).toBe('over')
  })

  it('shows one user nothing of another\'s lines, spending or history', async () => {
    store.addLine(BOB, '2026-06', GROCERIES, '999.0000')
    store.addSpend(BOB, '2026-06', GROCERIES, '500.0000')
    store.addSpend(BOB, '2026-06', DINING, '70.0000')
    store.addLine(ALICE, '2026-06', FUEL, '40.0000')

    const report = await serviceAt(MID_JUNE).getMonth(ALICE, '2026-06', 'UTC')

    expect(report.lines.map((l) => l.categoryId)).toEqual([FUEL])
    expect(report.unbudgeted).toEqual([])
    expect(report.summary.planned).toBe('40.0000')
  })
})

describe('upsertLine', () => {
  it('stores a line and reports its id', async () => {
    const saved = await serviceAt(MID_JUNE).upsertLine(ALICE, line({ note: 'x' }))

    expect(saved).toMatchObject({ categoryId: GROCERIES, planned: '100.0000', rollover: false })
    expect(store.lines).toHaveLength(1)
    expect(store.lines[0]).toMatchObject({ period_start: '2026-06-01', period_end: '2026-07-01', note: 'x' })
  })

  it('updates the same line rather than adding a second', async () => {
    const service = serviceAt(MID_JUNE)
    const first = await service.upsertLine(ALICE, line())
    const second = await service.upsertLine(ALICE, line({ planned: '250.0000', rollover: true }))

    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ planned: '250.0000', rollover: true })
    expect(store.lines).toHaveLength(1)
  })

  it('fails with 500 not_saved when the write returns no row', async () => {
    store.failNextUpsert = true

    const error = await failureOf(serviceAt(MID_JUNE).upsertLine(ALICE, line()))

    expect(error).toMatchObject({ statusCode: 500, code: 'not_saved' })
  })

  it('keeps two users\' lines for the same category and month apart', async () => {
    const service = serviceAt(MID_JUNE)
    const a = await service.upsertLine(ALICE, line({ planned: '10.0000' }))
    const b = await service.upsertLine(BOB, line({ planned: '20.0000' }))

    expect(a.id).not.toBe(b.id)
    expect(store.lines).toHaveLength(2)
  })
})

describe('adoptMonth', () => {
  it('copies every line of the previous month', async () => {
    store.addLine(ALICE, '2026-05', GROCERIES, '300.0000')
    store.addLine(ALICE, '2026-05', DINING, '80.0000')

    const result = await serviceAt(MID_JUNE).adoptMonth(ALICE, '2026-06')

    expect(result).toEqual({ created: 2, alreadyPlanned: 0 })
    expect(store.lines.filter((l) => l.period_start === '2026-06-01')).toHaveLength(2)
  })

  it('copies December into January of the next year', async () => {
    store.addLine(ALICE, '2026-12', GROCERIES, '300.0000')

    const result = await serviceAt(MID_JUNE).adoptMonth(ALICE, '2027-01')

    expect(result.created).toBe(1)
    expect(store.lines.some((l) => l.period_start === '2027-01-01')).toBe(true)
  })

  it('writes nothing and reports the count when the month is already planned', async () => {
    store.addLine(ALICE, '2026-05', GROCERIES, '300.0000')
    store.addLine(ALICE, '2026-06', DINING, '10.0000')
    store.addLine(ALICE, '2026-06', FUEL, '10.0000')

    const result = await serviceAt(MID_JUNE).adoptMonth(ALICE, '2026-06')

    expect(result).toEqual({ created: 0, alreadyPlanned: 2 })
    expect(store.writes).toBe(0)
  })

  it('fails with 409 nothing_to_copy when the previous month is empty', async () => {
    const error = await failureOf(serviceAt(MID_JUNE).adoptMonth(ALICE, '2026-06'))

    expect(error).toMatchObject({ statusCode: 409, code: 'nothing_to_copy' })
    expect(error.message).toContain('2026-05')
  })

  it('does not copy another user\'s lines', async () => {
    store.addLine(BOB, '2026-05', GROCERIES, '300.0000')

    const error = await failureOf(serviceAt(MID_JUNE).adoptMonth(ALICE, '2026-06'))

    expect(error.code).toBe('nothing_to_copy')
    expect(store.lines).toHaveLength(1)
  })
})

describe('deleteLine', () => {
  it('removes the caller\'s line', async () => {
    store.addLine(ALICE, '2026-06', DINING, '80.0000')

    const result = await serviceAt(MID_JUNE).deleteLine(ALICE, '2026-06', DINING)

    expect(result).toEqual({ removed: 1 })
    expect(store.lines).toEqual([])
  })

  it('fails with 404 for a line that does not exist', async () => {
    store.addLine(ALICE, '2026-06', DINING, '80.0000')

    const wrongMonth = await failureOf(serviceAt(MID_JUNE).deleteLine(ALICE, '2026-07', DINING))
    const wrongCategory = await failureOf(serviceAt(MID_JUNE).deleteLine(ALICE, '2026-06', FUEL))

    expect(wrongMonth).toMatchObject({ statusCode: 404, code: 'not_found' })
    expect(wrongCategory.statusCode).toBe(404)
    expect(store.lines).toHaveLength(1)
  })

  it('fails with 404 for another user\'s line and leaves it in place', async () => {
    const theirs = store.addLine(BOB, '2026-06', DINING, '80.0000')

    const error = await failureOf(serviceAt(MID_JUNE).deleteLine(ALICE, '2026-06', DINING))

    expect(error).toMatchObject({ statusCode: 404, code: 'not_found' })
    expect(store.lines).toEqual([theirs])
  })
})

describe('getAtRisk', () => {
  it('reports an unplanned month without touching the ledger figures', async () => {
    store.addSpend(ALICE, '2026-06', GROCERIES, '500.0000')

    const report = await serviceAt(MID_JUNE).getAtRisk(ALICE, 'UTC')

    expect(report).toEqual({ monthKey: '2026-06', today: '2026-06-15', planned: false, lines: [] })
  })

  it('ranks over before at-risk, and at-risk by pace', async () => {
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000')
    store.addLine(ALICE, '2026-06', DINING, '100.0000')
    store.addLine(ALICE, '2026-06', FUEL, '100.0000')
    store.addLine(ALICE, '2026-06', RENT, '100.0000')
    store.addLine(ALICE, '2026-06', GYM, '100.0000')
    store.addSpend(ALICE, '2026-06', GROCERIES, '80.0000') // pace 1.6, at risk
    store.addSpend(ALICE, '2026-06', DINING, '130.0000') // over
    store.addSpend(ALICE, '2026-06', FUEL, '90.0000') // pace 1.8, at risk
    store.addSpend(ALICE, '2026-06', RENT, '30.0000') // ahead, not listed

    const report = await serviceAt(MID_JUNE).getAtRisk(ALICE, 'UTC')

    expect(report.planned).toBe(true)
    expect(report.total).toBe(5)
    expect(report.lines.map((l) => l.categoryName)).toEqual(['Dining', 'Fuel', 'Groceries'])
    expect(report.lines.map((l) => l.health)).toEqual(['over', 'at-risk', 'at-risk'])
    // The summary covers every line, not only the ranked ones.
    expect(report.summary).toEqual({ spent: '330.0000', available: '500.0000' })
  })

  it('shows at most four lines but counts them all', async () => {
    for (const id of [GROCERIES, DINING, FUEL, RENT, GYM, TRAVEL]) {
      store.addLine(ALICE, '2026-06', id, '10.0000')
      store.addSpend(ALICE, '2026-06', id, '20.0000')
    }

    const report = await serviceAt(MID_JUNE).getAtRisk(ALICE, 'UTC')

    expect(report.lines).toHaveLength(4)
    expect(report.total).toBe(6)
  })

  it('lists nothing when every line is on pace', async () => {
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000')
    store.addLine(ALICE, '2026-06', DINING, '100.0000')
    store.addSpend(ALICE, '2026-06', GROCERIES, '40.0000')

    const report = await serviceAt(MID_JUNE).getAtRisk(ALICE, 'UTC')

    expect(report).toMatchObject({ planned: true, total: 2, lines: [] })
  })

  it('counts a rolled-over balance as available, so a line it covers is not over', async () => {
    store.addLine(ALICE, '2026-05', GROCERIES, '100.0000', { rollover: true })
    store.addSpend(ALICE, '2026-05', GROCERIES, '40.0000')
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000', { rollover: true })
    store.addSpend(ALICE, '2026-06', GROCERIES, '150.0000')
    store.addLine(ALICE, '2026-05', DINING, '100.0000')
    store.addSpend(ALICE, '2026-05', DINING, '40.0000')
    store.addLine(ALICE, '2026-06', DINING, '100.0000')
    store.addSpend(ALICE, '2026-06', DINING, '150.0000')

    const report = await serviceAt(MID_JUNE).getAtRisk(ALICE, 'UTC')

    const groceries = report.lines.find((l) => l.categoryId === GROCERIES)
    const dining = report.lines.find((l) => l.categoryId === DINING)
    expect(groceries).toMatchObject({ available: '160.0000', remaining: '10.0000', health: 'at-risk' })
    expect(dining).toMatchObject({ available: '100.0000', remaining: '-50.0000', health: 'over' })
    expect(report.lines[0]?.categoryId).toBe(DINING)
  })

  it('follows the clock across a month rollover', async () => {
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000')
    store.addSpend(ALICE, '2026-06', GROCERIES, '150.0000')
    const endOfJune = new Date('2026-06-30T12:00:00Z')
    const startOfJuly = new Date('2026-07-01T12:00:00Z')

    const june = await serviceAt(endOfJune).getAtRisk(ALICE, 'UTC')
    const july = await serviceAt(startOfJuly).getAtRisk(ALICE, 'UTC')

    expect(june).toMatchObject({ monthKey: '2026-06', planned: true })
    expect(june.lines).toHaveLength(1)
    expect(july).toEqual({ monthKey: '2026-07', today: '2026-07-01', planned: false, lines: [] })
  })

  it('rolls the year over with the clock', async () => {
    store.addLine(ALICE, '2027-01', GROCERIES, '100.0000')

    const report = await serviceAt(new Date('2026-12-31T23:30:00Z')).getAtRisk(ALICE, 'Pacific/Auckland')

    expect(report).toMatchObject({ monthKey: '2027-01', today: '2027-01-01', planned: true })
  })

  it('uses the caller\'s zone to decide which month is current', async () => {
    store.addLine(ALICE, '2026-07', GROCERIES, '100.0000')
    const lateJune = new Date('2026-06-30T23:30:00Z')

    const utc = await serviceAt(lateJune).getAtRisk(ALICE, 'UTC')
    const auckland = await serviceAt(lateJune).getAtRisk(ALICE, 'Pacific/Auckland')

    expect(utc.planned).toBe(false)
    expect(auckland).toMatchObject({ monthKey: '2026-07', planned: true })
  })

  it('reads the injected clock on every call, not once at construction', async () => {
    store.addLine(ALICE, '2026-06', GROCERIES, '100.0000')
    store.addLine(ALICE, '2026-07', GROCERIES, '100.0000')
    let instant = new Date('2026-06-10T00:00:00Z')
    const service = new BudgetService(new InMemoryBudgetUnitOfWork(store), () => instant)

    const before = await service.getAtRisk(ALICE, 'UTC')
    instant = new Date('2026-07-10T00:00:00Z')
    const after = await service.getAtRisk(ALICE, 'UTC')

    expect([before.monthKey, after.monthKey]).toEqual(['2026-06', '2026-07'])
  })

  it('shows one user nothing of another\'s trouble', async () => {
    store.addLine(BOB, '2026-06', GROCERIES, '10.0000')
    store.addSpend(BOB, '2026-06', GROCERIES, '500.0000')
    store.addLine(ALICE, '2026-06', DINING, '100.0000')
    store.addSpend(ALICE, '2026-06', DINING, '10.0000')

    const report = await serviceAt(MID_JUNE).getAtRisk(ALICE, 'UTC')

    expect(report).toMatchObject({ planned: true, total: 1, lines: [] })
    expect(report.summary).toEqual({ spent: '10.0000', available: '100.0000' })
  })
})
