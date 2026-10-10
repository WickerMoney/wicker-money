import { describe, expect, it } from 'vitest'
import {
  asOfInMonth, isBudgetable, isCalendarMonth, isDate, statusAt, windowElapsed, windowMonth, windowProblem,
} from './index.js'

describe('dates', () => {
  it('knows a real date from a well-shaped impossible one', () => {
    expect(isDate('2026-02-28')).toBe(true)
    expect(isDate('2028-02-29')).toBe(true)
    expect(isDate('2026-02-29')).toBe(false)
    expect(isDate('2026-13-01')).toBe(false)
    expect(isDate('2026-1-01')).toBe(false)
  })
})

describe('telling a monthly line from a window', () => {
  it('calls exactly one calendar month monthly', () => {
    expect(isCalendarMonth('2026-10-01', '2026-11-01')).toBe(true)
    expect(isCalendarMonth('2026-12-01', '2027-01-01')).toBe(true)
  })

  it('calls anything else a window, including a month-long span that starts mid-month', () => {
    expect(isCalendarMonth('2026-10-01', '2026-12-26')).toBe(false)
    expect(isCalendarMonth('2026-10-15', '2026-11-15')).toBe(false)
    expect(isCalendarMonth('2026-12-01', '2026-12-26')).toBe(false)
  })
})

describe('window validation', () => {
  it('accepts a holiday window', () => {
    expect(windowProblem('2026-10-01', '2026-12-25')).toBeNull()
  })

  it('accepts a single day', () => {
    expect(windowProblem('2026-12-24', '2026-12-24')).toBeNull()
  })

  it('refuses one ending before it starts', () => {
    expect(windowProblem('2026-12-25', '2026-10-01')).toMatch(/ends before/)
  })

  it('refuses exactly one calendar month, which is a monthly line', () => {
    expect(windowProblem('2026-11-01', '2026-11-30')).toMatch(/one calendar month/)
  })

  it('accepts exactly 24 months and refuses a day more', () => {
    expect(windowProblem('2026-01-01', '2027-12-31')).toBeNull()
    expect(windowProblem('2026-01-01', '2028-01-01')).toMatch(/24 months/)
  })
})

describe('window elapsed', () => {
  it('is 0 before, 1 after, and counts today while inside', () => {
    expect(windowElapsed('2026-10-01', '2026-12-26', '2026-09-30')).toBe(0)
    expect(windowElapsed('2026-10-01', '2026-12-26', '2026-12-26')).toBe(1)
    // 86 days; the first day counts as one of them.
    expect(windowElapsed('2026-10-01', '2026-12-26', '2026-10-01')).toBeCloseTo(1 / 86, 9)
    expect(windowElapsed('2026-10-01', '2026-12-26', '2026-12-25')).toBe(1)
  })

  it('judges a past month as of its last day and a current or future month as of today', () => {
    expect(asOfInMonth('2026-10', '2026-11-15')).toBe('2026-10-31')
    expect(asOfInMonth('2026-11', '2026-11-15')).toBe('2026-11-15')
    expect(asOfInMonth('2026-12', '2026-11-15')).toBe('2026-11-15')
  })
})

describe('a window, month by month', () => {
  const base = { start: '2026-10-01', funded: '1500.0000' }

  it('plans the whole pot in its first month', () => {
    expect(windowMonth({ ...base, monthKey: '2026-10', spentBefore: '0.0000', spentInMonth: '200.0000' })).toEqual({
      planned: '1500.0000', carriedIn: '0.0000', available: '1500.0000',
      spent: '200.0000', remaining: '1300.0000', spentToDate: '200.0000',
    })
  })

  it('plans nothing afterwards and carries in what is left', () => {
    expect(windowMonth({ ...base, monthKey: '2026-12', spentBefore: '500.0000', spentInMonth: '150.0000' })).toEqual({
      planned: '0.0000', carriedIn: '1000.0000', available: '1000.0000',
      spent: '150.0000', remaining: '850.0000', spentToDate: '650.0000',
    })
  })

  it('carries an overdrawn pot as a negative, like a rollover line', () => {
    const dec = windowMonth({ ...base, monthKey: '2026-12', spentBefore: '1600.0000', spentInMonth: '0.0000' })
    expect(dec.carriedIn).toBe('-100.0000')
    expect(dec.remaining).toBe('-100.0000')
  })
})

describe('status over a period', () => {
  const line = {
    categoryId: 'c', categoryName: 'Gifts', planned: '1500.0000', available: '1500.0000',
    spent: '750.0000', remaining: '750.0000', rollover: false,
  }

  it('is on track when half the pot is gone halfway through', () => {
    expect(statusAt(line, 0.5)).toMatchObject({ used: 0.5, pace: 1, elapsed: 0.5, health: 'on-track' })
  })

  it('is at risk when half the pot is gone a quarter of the way through', () => {
    expect(statusAt(line, 0.25).health).toBe('at-risk')
  })

  it('leaves pace out of health when asked, as windows do, but still reports it', () => {
    expect(statusAt(line, 0.25, { judgePace: false })).toMatchObject({ pace: 2, health: 'on-track' })
    expect(statusAt({ ...line, spent: '1600.0000', remaining: '-100.0000' }, 0.25, { judgePace: false }).health)
      .toBe('over')
  })

  it('stops judging pace once the period is over', () => {
    expect(statusAt(line, 1).health).toBe('on-track')
  })
})

describe('which categories a budget can carry', () => {
  it('leaves out income and transfers, which the spend query never counts', () => {
    expect(isBudgetable({ kind: 'expense' })).toBe(true)
    expect(isBudgetable({ kind: 'income' })).toBe(false)
    expect(isBudgetable({ kind: 'transfer' })).toBe(false)
  })

  it('offers a category from a server that does not send a kind', () => {
    expect(isBudgetable({})).toBe(true)
  })
})
