import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryBudgetStore } from '../testing/InMemoryBudgetStore.js'
import { InMemoryBudgetUnitOfWork } from '../testing/InMemoryBudgetUnitOfWork.js'
import { BudgetError } from './BudgetError.js'
import { BudgetService } from './BudgetService.js'
import type { WindowInput } from './WindowInput.js'

const ALICE = 'user-alice'
const BOB = 'user-bob'
const GIFTS = 'cat-01-gifts'
const GROCERIES = 'cat-02-groceries'

/** November 15: a little over half of an October 1 – December 25 window has passed. */
const MID_NOVEMBER = new Date('2026-11-15T12:00:00Z')

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

const holiday = (overrides: Partial<WindowInput> = {}): WindowInput => ({
  id: null, categoryId: GIFTS, start: '2026-10-01', through: '2026-12-25', planned: '1500.0000', note: null,
  ...overrides,
})

beforeEach(() => {
  store = new InMemoryBudgetStore()
  store.addCategory(GIFTS, 'Gifts')
  store.addCategory(GROCERIES, 'Groceries')
})

describe('upsertWindow', () => {
  it('stores the window with an exclusive end and reports the inclusive one back', async () => {
    const saved = await serviceAt(MID_NOVEMBER).upsertWindow(ALICE, holiday())

    expect(saved).toMatchObject({ categoryId: GIFTS, start: '2026-10-01', through: '2026-12-25', planned: '1500.0000' })
    expect(store.lines[0]).toMatchObject({ period_start: '2026-10-01', period_end: '2026-12-26', rollover: false })
  })

  it('refuses dates that do not make a window before touching the store', async () => {
    const error = await failureOf(
      serviceAt(MID_NOVEMBER).upsertWindow(ALICE, holiday({ start: '2026-11-01', through: '2026-11-30' })),
    )
    expect(error).toMatchObject({ statusCode: 400, code: 'bad_window' })
    expect(store.writes).toBe(0)
  })

  it('turns an overlap into a 409', async () => {
    store.addLine(ALICE, '2026-11', GIFTS, '50.0000')
    const error = await failureOf(serviceAt(MID_NOVEMBER).upsertWindow(ALICE, holiday()))
    expect(error).toMatchObject({ statusCode: 409, code: 'overlaps' })
  })

  it('reports updating someone else\'s window as not found', async () => {
    const theirs = store.addWindow(BOB, GIFTS, '2026-10-01', '2026-12-25', '100.0000')
    const error = await failureOf(serviceAt(MID_NOVEMBER).upsertWindow(ALICE, holiday({ id: theirs.id })))
    expect(error).toMatchObject({ statusCode: 404, code: 'not_found' })
  })
})

describe('upsertLine next to a window', () => {
  it('refuses a monthly line the window already covers', async () => {
    store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1500.0000')
    const error = await failureOf(serviceAt(MID_NOVEMBER).upsertLine(ALICE, {
      monthKey: '2026-12', categoryId: GIFTS, planned: '10.0000', rollover: false, note: null,
    }))
    expect(error).toMatchObject({ statusCode: 409, code: 'overlaps' })
  })
})

describe('getMonth with a window', () => {
  beforeEach(() => {
    store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1500.0000')
    store.addSpend(ALICE, '2026-10', GIFTS, '200.0000')
    store.addSpend(ALICE, '2026-11', GIFTS, '700.0000')
  })

  it('shows the pot coming into the month, the month\'s spend and what is left', async () => {
    const report = await serviceAt(MID_NOVEMBER).getMonth(ALICE, '2026-11', 'UTC')
    const gifts = report.lines.find((l) => l.categoryId === GIFTS)

    expect(gifts).toMatchObject({
      planned: '0.0000', carriedIn: '1300.0000', available: '1300.0000', spent: '700.0000', remaining: '600.0000',
      window: { start: '2026-10-01', through: '2026-12-25', funded: '1500.0000', spentToDate: '900.0000' },
    })
  })

  it('measures pace against the whole window, not against November', async () => {
    const report = await serviceAt(MID_NOVEMBER).getMonth(ALICE, '2026-11', 'UTC')
    const gifts = report.lines.find((l) => l.categoryId === GIFTS)!

    // 46 of 86 days gone, 60% of the pot gone.
    expect(gifts.elapsed).toBeCloseTo(46 / 86, 9)
    expect(gifts.used).toBeCloseTo(0.6, 9)
    expect(gifts.pace).toBeCloseTo(0.6 / (46 / 86), 9)
    expect(gifts.health).toBe('on-track')
  })

  it('is a stored line even in a month that is otherwise a draft', async () => {
    store.addLine(ALICE, '2026-10', GROCERIES, '400.0000')

    const report = await serviceAt(MID_NOVEMBER).getMonth(ALICE, '2026-11', 'UTC')

    expect(report.draft).toBe(true)
    expect(report.lines.find((l) => l.categoryId === GIFTS)).toMatchObject({ draft: false, window: expect.anything() })
    expect(report.lines.find((l) => l.categoryId === GROCERIES)).toMatchObject({ draft: true, window: null })
    expect(store.writes).toBe(0)
  })

  it('never drafts a monthly line for a category a window covers', async () => {
    store.addLine(ALICE, '2026-09', GIFTS, '25.0000')
    store.addLine(ALICE, '2026-09', GROCERIES, '400.0000')

    const report = await serviceAt(MID_NOVEMBER).getMonth(ALICE, '2026-10', 'UTC')

    expect(report.lines.filter((l) => l.categoryId === GIFTS)).toHaveLength(1)
    expect(report.lines.find((l) => l.categoryId === GIFTS)?.window).not.toBeNull()
  })

  it('counts the funding once in the totals', async () => {
    const oct = await serviceAt(MID_NOVEMBER).getMonth(ALICE, '2026-10', 'UTC')
    const nov = await serviceAt(MID_NOVEMBER).getMonth(ALICE, '2026-11', 'UTC')
    expect(oct.summary.planned).toBe('1500.0000')
    expect(nov.summary.planned).toBe('0.0000')
    expect(nov.summary.remaining).toBe('600.0000')
  })

  it('keeps it out of the unbudgeted list', async () => {
    const report = await serviceAt(MID_NOVEMBER).getMonth(ALICE, '2026-11', 'UTC')
    expect(report.unbudgeted).toEqual([])
  })

  it('shows another user nothing', async () => {
    const report = await serviceAt(MID_NOVEMBER).getMonth(BOB, '2026-11', 'UTC')
    expect(report.lines).toEqual([])
  })
})

describe('adoptMonth next to a window', () => {
  it('copies the other lines and skips the covered category', async () => {
    store.addLine(ALICE, '2026-09', GIFTS, '25.0000')
    store.addLine(ALICE, '2026-09', GROCERIES, '400.0000')
    store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1500.0000')

    const result = await serviceAt(MID_NOVEMBER).adoptMonth(ALICE, '2026-10')

    expect(result).toEqual({ created: 1, alreadyPlanned: 0 })
    const october = store.lines.filter((l) => l.period_start === '2026-10-01')
    expect(october.map((l) => l.category_id).sort()).toEqual([GIFTS, GROCERIES])
    expect(october.find((l) => l.category_id === GIFTS)?.period_end).toBe('2026-12-26')
  })
})

describe('deleteWindow', () => {
  it('removes the window', async () => {
    const w = store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1500.0000')
    expect(await serviceAt(MID_NOVEMBER).deleteWindow(ALICE, w.id)).toEqual({ removed: 1 })
    expect(store.lines).toEqual([])
  })

  it('will not remove a monthly line by its id', async () => {
    const line = store.addLine(ALICE, '2026-11', GROCERIES, '400.0000')
    const error = await failureOf(serviceAt(MID_NOVEMBER).deleteWindow(ALICE, line.id))
    expect(error).toMatchObject({ statusCode: 404, code: 'not_found' })
    expect(store.lines).toHaveLength(1)
  })
})

describe('getAtRisk with a window', () => {
  it('does not call lumpy spending at risk: most of the pot gone early is how gift shopping goes', async () => {
    store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1000.0000')
    store.addSpend(ALICE, '2026-10', GIFTS, '900.0000')

    const report = await serviceAt(MID_NOVEMBER).getAtRisk(ALICE, 'UTC')

    expect(report.lines).toEqual([])
    expect(report.breakdown).toEqual([expect.objectContaining({ categoryId: GIFTS, health: 'on-track' })])
  })

  it('ranks an overdrawn window as over, shown as the whole pot', async () => {
    store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1000.0000')
    store.addSpend(ALICE, '2026-10', GIFTS, '900.0000')
    store.addSpend(ALICE, '2026-11', GIFTS, '150.0000')

    const report = await serviceAt(MID_NOVEMBER).getAtRisk(ALICE, 'UTC')

    expect(report.lines).toEqual([expect.objectContaining({
      categoryId: GIFTS, health: 'over', spent: '1050.0000', available: '1000.0000', remaining: '-50.0000',
    })])
    // The widget gets the shared shape only, without the page's extra fields.
    expect(report.lines[0]).not.toHaveProperty('window')
  })

  it('reports a month with only a window as planned', async () => {
    store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1000.0000')
    const report = await serviceAt(MID_NOVEMBER).getAtRisk(ALICE, 'UTC')
    expect(report).toMatchObject({ planned: true, total: 1 })
  })
})
