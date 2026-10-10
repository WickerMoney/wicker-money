import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryBudgetStore } from '../testing/InMemoryBudgetStore.js'
import { InMemoryBudgetUnitOfWork } from '../testing/InMemoryBudgetUnitOfWork.js'
import { BudgetService } from './BudgetService.js'
import type { MonthLine } from './MonthLine.js'

/**
 * Characterization of how windows and rollover history turn dated spending into
 * figures, with the expected numbers taken from the per-window implementation
 * (and, for the SQL, from running it against PostgreSQL). These pin behaviour
 * across the batched-query refactor: the same ledger must give the same page.
 */

const ALICE = 'user-alice'
const BOB = 'user-bob'
const GIFTS = 'cat-01-gifts'
const TRIP = 'cat-02-trip'
const HOBBY = 'cat-03-hobby'
const EMPTY = 'cat-04-empty'
const NETS_ZERO = 'cat-05-zero'
const GROCERIES = 'cat-06-groceries'
const FUEL = 'cat-07-fuel'

const OCTOBER_10 = new Date('2026-10-10T12:00:00Z')

let store: InMemoryBudgetStore

const service = (now = OCTOBER_10) => new BudgetService(new InMemoryBudgetUnitOfWork(store), () => now)

async function lineFor(month: string, categoryId: string, user = ALICE, now = OCTOBER_10): Promise<MonthLine> {
  const report = await service(now).getMonth(user, month, 'UTC')
  const line = report.lines.find((l) => l.categoryId === categoryId)
  if (line === undefined) throw new Error(`no line for ${categoryId} in ${month}`)
  return line
}

const figures = (l: MonthLine) => ({
  planned: l.planned, carriedIn: l.carriedIn, available: l.available, spent: l.spent, remaining: l.remaining,
  spentToDate: l.window?.spentToDate,
})

beforeEach(() => {
  store = new InMemoryBudgetStore()
  for (const [id, name] of [
    [GIFTS, 'Gifts'], [TRIP, 'Trip'], [HOBBY, 'Hobby'], [EMPTY, 'Empty'], [NETS_ZERO, 'Zero'],
    [GROCERIES, 'Groceries'], [FUEL, 'Fuel'],
  ] as const) store.addCategory(id, name)
})

describe('a window that starts and ends mid-month', () => {
  beforeEach(() => {
    store.addWindow(ALICE, GIFTS, '2026-09-15', '2026-11-20', '500.0000')
    for (const [date, spent] of [
      ['2026-09-10', '11.1100'], // before the window opens
      ['2026-09-15', '12.0000'], // its first day
      ['2026-09-30', '20.0500'],
      ['2026-10-01', '5.0000'],
      ['2026-10-12', '-10.0000'], // a refund
      ['2026-10-31', '7.7700'],
      ['2026-11-01', '9.0000'],
      ['2026-11-20', '3.3300'], // its last day
      ['2026-11-21', '4.4400'], // after it closes
    ] as const) store.addSpendOn(ALICE, date, GIFTS, spent)
  })

  it('opens on the start day: September\'s first fortnight is not part of the window', async () => {
    const september = await lineFor('2026-09', GIFTS)
    expect(figures(september)).toEqual({
      planned: '500.0000', carriedIn: '0.0000', available: '500.0000', spent: '32.0500', remaining: '467.9500',
      spentToDate: '32.0500',
    })
  })

  it('counts a refund against the month it falls in, and carries the rest in', async () => {
    const october = await lineFor('2026-10', GIFTS)
    expect(figures(october)).toEqual({
      planned: '0.0000', carriedIn: '467.9500', available: '467.9500', spent: '2.7700', remaining: '465.1800',
      spentToDate: '34.8200',
    })
  })

  it('closes on the end day: the day after is spending nobody budgeted', async () => {
    const november = await lineFor('2026-11', GIFTS)
    expect(figures(november)).toEqual({
      planned: '0.0000', carriedIn: '465.1800', available: '465.1800', spent: '12.3300', remaining: '452.8500',
      spentToDate: '47.1500',
    })
    const report = await service().getMonth(ALICE, '2026-11', 'UTC')
    expect(report.unbudgeted).toEqual([{ categoryId: GIFTS, categoryName: 'Gifts', spent: '4.4400' }])
  })

  it('has no line in a month the window does not touch', async () => {
    const august = await service().getMonth(ALICE, '2026-08', 'UTC')
    const december = await service().getMonth(ALICE, '2026-12', 'UTC')
    expect(august.lines).toEqual([])
    expect(december.lines).toEqual([])
    expect(december.unbudgeted).toEqual([])
  })
})

describe('windows that meet or cross a boundary', () => {
  it('keeps two back-to-back windows on one category apart within a month', async () => {
    store.addWindow(ALICE, HOBBY, '2026-10-01', '2026-10-14', '80.0000')
    store.addWindow(ALICE, HOBBY, '2026-10-15', '2026-12-01', '90.0000')
    for (const [date, spent] of [
      ['2026-10-01', '1.5000'], ['2026-10-14', '2.5000'], ['2026-10-15', '4.0000'], ['2026-12-01', '8.0000'],
      ['2026-12-02', '16.0000'],
    ] as const) store.addSpendOn(ALICE, date, HOBBY, spent)

    const report = await service().getMonth(ALICE, '2026-10', 'UTC')
    const [first, second] = report.lines.filter((l) => l.categoryId === HOBBY)

    expect(figures(first!)).toMatchObject({ planned: '80.0000', spent: '4.0000', remaining: '76.0000', spentToDate: '4.0000' })
    expect(figures(second!)).toMatchObject({ planned: '90.0000', spent: '4.0000', remaining: '86.0000', spentToDate: '4.0000' })
    // Both windows' October spend leaves the unbudgeted check; nothing is left over.
    expect(report.unbudgeted).toEqual([])
    expect(report.summary.planned).toBe('170.0000')
  })

  it('runs across a year end, with spend on both of its edges', async () => {
    store.addWindow(ALICE, TRIP, '2026-11-20', '2027-02-10', '400.1234')
    for (const [date, spent] of [
      ['2026-11-19', '1.0000'], ['2026-11-20', '2.0000'], ['2026-12-31', '4.0000'], ['2027-01-31', '8.0000'],
      ['2027-02-10', '16.0000'], ['2027-02-11', '32.0000'],
    ] as const) store.addSpendOn(ALICE, date, TRIP, spent)

    expect(figures(await lineFor('2026-11', TRIP))).toEqual({
      planned: '400.1234', carriedIn: '0.0000', available: '400.1234', spent: '2.0000', remaining: '398.1234', spentToDate: '2.0000',
    })
    expect(figures(await lineFor('2026-12', TRIP))).toMatchObject({ carriedIn: '398.1234', spent: '4.0000', spentToDate: '6.0000' })
    expect(figures(await lineFor('2027-01', TRIP))).toMatchObject({ carriedIn: '394.1234', spent: '8.0000', spentToDate: '14.0000' })
    expect(figures(await lineFor('2027-02', TRIP))).toMatchObject({ carriedIn: '386.1234', spent: '16.0000', spentToDate: '30.0000', remaining: '370.1234' })
    const after = await service().getMonth(ALICE, '2027-03', 'UTC')
    expect(after.lines).toEqual([])
  })

  it('reports a window that starts mid-month from its start day, not the 1st', async () => {
    store.addWindow(ALICE, TRIP, '2026-10-20', '2026-12-31', '1200.5000')
    for (const [date, spent] of [
      ['2026-10-19', '1.0000'], ['2026-10-20', '2.0000'], ['2026-11-30', '3.0000'], ['2026-12-31', '5.0000'],
      ['2027-01-01', '6.0000'],
    ] as const) store.addSpendOn(ALICE, date, TRIP, spent)

    const october = await service().getMonth(ALICE, '2026-10', 'UTC')
    expect(figures(october.lines[0]!)).toMatchObject({ planned: '1200.5000', spent: '2.0000', remaining: '1198.5000' })
    // The 19th is before the window: unbudgeted, not part of the pot.
    expect(october.unbudgeted).toEqual([{ categoryId: TRIP, categoryName: 'Trip', spent: '1.0000' }])
    expect(figures(await lineFor('2026-12', TRIP))).toMatchObject({ carriedIn: '1195.5000', spent: '5.0000', spentToDate: '10.0000' })
  })
})

describe('windows with nothing, or nothing net, spent', () => {
  it('has the whole pot left when no money has moved', async () => {
    store.addWindow(ALICE, EMPTY, '2026-08-10', '2026-12-10', '300.0000')

    expect(figures(await lineFor('2026-10', EMPTY))).toEqual({
      planned: '0.0000', carriedIn: '300.0000', available: '300.0000', spent: '0.0000', remaining: '300.0000',
      spentToDate: '0.0000',
    })
  })

  it('treats spending and a refund that cancel as nothing spent', async () => {
    store.addWindow(ALICE, NETS_ZERO, '2026-09-02', '2026-11-25', '60.0000')
    store.addSpendOn(ALICE, '2026-09-20', NETS_ZERO, '20.0000')
    store.addSpendOn(ALICE, '2026-10-20', NETS_ZERO, '-20.0000')

    // September is 20 down, then October's refund puts it back: 40 carried in
    // while the month itself shows the refund as negative spend.
    expect(figures(await lineFor('2026-10', NETS_ZERO))).toMatchObject({ carriedIn: '40.0000', spent: '-20.0000', remaining: '60.0000' })
    expect(figures(await lineFor('2026-11', NETS_ZERO))).toMatchObject({ carriedIn: '60.0000', spent: '0.0000', remaining: '60.0000' })
  })

  it('keeps each window\'s spend to its own category and its own user', async () => {
    store.addWindow(ALICE, GIFTS, '2026-10-01', '2026-12-25', '1500.0000')
    store.addWindow(BOB, GIFTS, '2026-10-01', '2026-12-25', '10.0000')
    store.addSpendOn(ALICE, '2026-10-05', GIFTS, '100.0000')
    store.addSpendOn(ALICE, '2026-10-05', GROCERIES, '33.0000')
    store.addSpendOn(BOB, '2026-10-05', GIFTS, '7.0000')

    expect(figures(await lineFor('2026-10', GIFTS))).toMatchObject({ spent: '100.0000', remaining: '1400.0000' })
    expect(figures(await lineFor('2026-10', GIFTS, BOB))).toMatchObject({ spent: '7.0000', remaining: '3.0000' })
  })

  it('reports several windows in one month side by side', async () => {
    store.addWindow(ALICE, GIFTS, '2026-09-15', '2026-11-20', '500.0000')
    store.addWindow(ALICE, TRIP, '2026-10-20', '2026-12-31', '1200.5000')
    store.addWindow(ALICE, EMPTY, '2026-08-10', '2026-12-10', '300.0000')
    store.addSpendOn(ALICE, '2026-09-20', GIFTS, '10.0000')
    store.addSpendOn(ALICE, '2026-10-21', TRIP, '25.2500')

    const report = await service().getMonth(ALICE, '2026-10', 'UTC')

    expect(report.lines.map((l) => [l.categoryId, l.remaining])).toEqual([
      [GIFTS, '490.0000'], [TRIP, '1175.2500'], [EMPTY, '300.0000'],
    ].sort((a, b) => a[0]!.localeCompare(b[0]!)))
  })
})

describe('windows beside rolling categories', () => {
  it('replays a rolling category without a window\'s spend or its own later spend', async () => {
    store.addWindow(ALICE, GIFTS, '2026-09-15', '2026-11-20', '500.0000')
    store.addSpendOn(ALICE, '2026-09-20', GIFTS, '50.0000')
    for (const m of ['2026-08', '2026-09', '2026-10']) store.addLine(ALICE, m, GROCERIES, '100.0000', { rollover: true })
    store.addSpendOn(ALICE, '2026-08-09', GROCERIES, '70.0000')
    store.addSpendOn(ALICE, '2026-09-09', GROCERIES, '120.0000')
    store.addSpendOn(ALICE, '2026-10-09', GROCERIES, '15.0000')

    const report = await service().getMonth(ALICE, '2026-10', 'UTC')
    const groceries = report.lines.find((l) => l.categoryId === GROCERIES)!

    // August leaves 30; September has 130, spends 120, leaves 10.
    expect(figures(groceries)).toMatchObject({ carriedIn: '10.0000', available: '110.0000', spent: '15.0000', remaining: '95.0000' })
    expect(report.lines.find((l) => l.categoryId === GIFTS)).toMatchObject({ carriedIn: '450.0000', spent: '0.0000' })
  })

  it('breaks the rolling chain at a missing month and carries again after it', async () => {
    for (const m of ['2026-04', '2026-05', '2026-07', '2026-08', '2026-09', '2026-10']) {
      store.addLine(ALICE, m, FUEL, '40.0000', { rollover: true })
      store.addSpendOn(ALICE, `${m}-11`, FUEL, '34.0000')
    }
    expect(figures(await lineFor('2026-10', FUEL))).toMatchObject({ carriedIn: '18.0000', spent: '34.0000' })
  })

  it('looks back 24 months and no further', async () => {
    // Lines every month from April 2024; June 2026 is 26 months later, so the
    // replay starts at June 2024 and carries 24 months of 10.
    for (let i = 0; i < 27; i++) {
      const month = 2024 * 12 + 3 + i
      const key = `${Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`
      store.addLine(ALICE, key, GROCERIES, '10.0000', { rollover: true })
    }
    expect(figures(await lineFor('2026-06', GROCERIES))).toMatchObject({ carriedIn: '240.0000', available: '250.0000' })
  })

  it('ranks windows and rolling lines together on the dashboard', async () => {
    store.addWindow(ALICE, GIFTS, '2026-09-15', '2026-11-20', '500.0000')
    store.addSpendOn(ALICE, '2026-09-20', GIFTS, '450.0000')
    store.addSpendOn(ALICE, '2026-10-05', GIFTS, '100.0000')
    store.addLine(ALICE, '2026-09', GROCERIES, '100.0000', { rollover: true })
    store.addLine(ALICE, '2026-10', GROCERIES, '100.0000', { rollover: true })
    store.addSpendOn(ALICE, '2026-09-09', GROCERIES, '130.0000')
    store.addSpendOn(ALICE, '2026-10-02', GROCERIES, '5.0000')

    const report = await service().getAtRisk(ALICE, 'UTC')

    // The window shows as the whole pot; Groceries carries -30 in, so 65 is left.
    expect(report.lines.map((l) => [l.categoryId, l.health, l.spent, l.remaining])).toEqual([
      [GIFTS, 'over', '550.0000', '-50.0000'],
    ])
    expect(report.breakdown?.find((l) => l.categoryId === GROCERIES)).toMatchObject({
      spent: '5.0000', available: '70.0000', remaining: '65.0000',
    })
  })
})
