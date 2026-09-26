import { beforeEach, describe, expect, it } from 'vitest'
import { firstOfMonthBefore } from './firstOfMonthBefore.js'
import { ReportService } from './ReportService.js'
import { InMemoryReportUnitOfWork } from './testing/InMemoryReportUnitOfWork.js'
import { todayIn } from './todayIn.js'

describe('todayIn', () => {
  const instant = new Date('2026-03-01T03:30:00Z')

  it('gives the date in the given zone, which can differ from the UTC date', () => {
    expect(todayIn('UTC', instant)).toBe('2026-03-01')
    expect(todayIn('America/New_York', instant)).toBe('2026-02-28')
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-03-01')
    expect(todayIn('Pacific/Kiritimati', new Date('2026-02-28T12:00:00Z'))).toBe('2026-03-01')
  })

  it('falls back to the UTC date for an unknown zone', () => {
    expect(todayIn('Mars/Olympus', instant)).toBe('2026-03-01')
  })
})

describe('firstOfMonthBefore', () => {
  it('steps back whole months, across year ends', () => {
    expect(firstOfMonthBefore('2026-03-15', 0)).toBe('2026-03-01')
    expect(firstOfMonthBefore('2026-03-15', 1)).toBe('2026-02-01')
    expect(firstOfMonthBefore('2026-03-15', 2)).toBe('2026-01-01')
    expect(firstOfMonthBefore('2026-03-15', 3)).toBe('2025-12-01')
    expect(firstOfMonthBefore('2026-01-31', 35)).toBe('2023-02-01')
  })
})

describe('ReportService.monthlySummary', () => {
  let uow: InMemoryReportUnitOfWork
  let now: Date
  let service: ReportService

  beforeEach(() => {
    uow = new InMemoryReportUnitOfWork()
    now = new Date('2026-03-15T12:00:00Z')
    service = new ReportService(uow, () => now)
  })

  it('covers the current month and the ones before it', async () => {
    await service.monthlySummary('u', 3)
    expect(uow.sinceRequested).toEqual(['2026-01-01'])
  })

  it('clamps the requested months to 1-36 and defaults a non-number to 12', async () => {
    expect((await service.monthlySummary('u', 0)).months).toBe(1)
    expect((await service.monthlySummary('u', -4)).months).toBe(1)
    expect((await service.monthlySummary('u', 500)).months).toBe(36)
    expect((await service.monthlySummary('u', 2.9)).months).toBe(2)
    expect((await service.monthlySummary('u', Number.NaN)).months).toBe(12)
    expect(uow.sinceRequested[0]).toBe('2026-03-01')
    expect(uow.sinceRequested[2]).toBe('2023-04-01')
  })

  it("decides the current month in the user's time zone, not the server's", async () => {
    now = new Date('2026-03-01T03:00:00Z')

    uow.timezone = 'UTC'
    await service.monthlySummary('u', 1)
    uow.timezone = 'America/New_York'
    await service.monthlySummary('u', 1)

    // Still February on the user's wall clock, so the window is February.
    expect(uow.sinceRequested).toEqual(['2026-03-01', '2026-02-01'])
  })

  it('treats a missing user record as UTC', async () => {
    uow.timezone = undefined
    now = new Date('2026-03-01T03:00:00Z')
    await service.monthlySummary('u', 1)
    expect(uow.sinceRequested).toEqual(['2026-03-01'])
  })

  it('names uncategorized rows and reshapes the rest', async () => {
    uow.totals = [
      { month: '2026-03', category_id: null, category_name: null, kind: 'expense', total: '4.5000' },
      { month: '2026-03', category_id: 'c1', category_name: 'Salary', kind: 'income', total: '100.0000' },
    ]
    const { rows } = await service.monthlySummary('u', 1)
    expect(rows).toEqual([
      { month: '2026-03', categoryId: null, categoryName: 'Uncategorized', kind: 'expense', total: '4.5000' },
      { month: '2026-03', categoryId: 'c1', categoryName: 'Salary', kind: 'income', total: '100.0000' },
    ])
  })
})
