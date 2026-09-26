import { describe, expect, it } from 'vitest'
import {
  AT_RISK_PACE, addMoney, balanceFor, carryForward, daysInMonth, draftPlannedFrom,
  editableMoney, elapsedFraction, formatMoney, isMonthKey, isValidPlan, monthKeyOf, monthPeriod,
  parseMoney, previousMonth, rankAtRisk, ratio, shiftMonth, statusFor, subtractMoney,
  sumMoney, todayIn, totalPlanned, type HistoryEntry,
} from './index.js'

describe('month periods', () => {
  it('is half-open, so the end is the next month rather than the last day', () => {
    // A closed range invites "31 or 30 or 28?" at every call site. Half-open
    // makes the spend predicate a plain >= / < pair with no month table.
    expect(monthPeriod('2026-03')).toEqual({ start: '2026-03-01', end: '2026-04-01' })
  })

  it('rolls the year at December', () => {
    expect(monthPeriod('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
  })

  it('handles February in a leap year without a special case', () => {
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2026-01')).toBe(31)
  })

  it('shifts across year boundaries in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-05', -17)).toBe('2024-12')
    expect(shiftMonth('2026-05', 25)).toBe('2028-06')
  })

  it('round-trips a shift', () => {
    for (const key of ['2024-01', '2026-06', '2026-12']) {
      expect(shiftMonth(shiftMonth(key, 7), -7)).toBe(key)
    }
  })

  it('rejects a month that is not one', () => {
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-00')).toBe(false)
    expect(isMonthKey('2026-1')).toBe(false)
    expect(isMonthKey('2026-03-01')).toBe(false)
    expect(() => monthPeriod('2026-13')).toThrow()
  })

  it('reads the month off a date', () => {
    expect(monthKeyOf('2026-03-04')).toBe('2026-03')
    expect(previousMonth('2026-03')).toBe('2026-02')
  })
})

describe('today in a zone', () => {
  it('uses the zone, not UTC', () => {
    // 03:30 UTC on the 5th is still the 4th in New York. Treating
    // every date as UTC would put this transaction in the wrong month.
    const instant = new Date('2026-03-05T03:30:00Z')
    expect(todayIn('UTC', instant)).toBe('2026-03-05')
    expect(todayIn('America/New_York', instant)).toBe('2026-03-04')
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-03-05')
  })

  it('falls back to UTC for a zone it does not recognise', () => {
    // A bad timezone string on a user row should show the wrong month, not
    // take the budgets page down.
    expect(todayIn('Mars/Olympus', new Date('2026-03-05T03:30:00Z'))).toBe('2026-03-05')
  })
})

describe('elapsed fraction', () => {
  it('counts the current day, so the 1st is not zero', () => {
    // At zero, pace is undefined and every line looks untouched on day one.
    expect(elapsedFraction('2026-03', '2026-03-01')).toBeCloseTo(1 / 31)
    expect(elapsedFraction('2026-03', '2026-03-31')).toBeCloseTo(1)
  })

  it('is 1 for a finished month and 0 for one that has not started', () => {
    expect(elapsedFraction('2026-03', '2026-04-02')).toBe(1)
    expect(elapsedFraction('2026-03', '2026-02-27')).toBe(0)
  })
})

describe('money as text', () => {
  it('round-trips the four places the column stores', () => {
    expect(formatMoney(parseMoney('-81.2000'))).toBe('-81.2000')
    expect(formatMoney(parseMoney('81.2'))).toBe('81.2000')
    expect(formatMoney(parseMoney('0'))).toBe('0.0000')
  })

  it('adds without going through a float', () => {
    // 0.1 + 0.2 in binary floating point is 0.30000000000000004. Over a month
    // of grocery rows that is how a budget stops reconciling by a cent nobody
    // can find.
    expect(addMoney('0.1000', '0.2000')).toBe('0.3000')
    expect(sumMoney(['0.1000', '0.2000', '0.3000'])).toBe('0.6000')
    expect(subtractMoney('100.0000', '33.3300')).toBe('66.6700')
  })

  it('handles very large amounts that would lose precision as a double', () => {
    expect(addMoney('99999999999.9999', '0.0001')).toBe('100000000000.0000')
  })

  it('refuses a value that is not an amount rather than silently yielding NaN', () => {
    expect(() => parseMoney('abc')).toThrow()
    expect(() => parseMoney('')).toThrow()
    expect(() => parseMoney('1,000.00')).toThrow()
  })

  it('treats a zero plan with spending as fully used rather than untouched', () => {
    // Returning 0 would draw an empty bar for a category overspent against a
    // plan of nothing, which is the opposite of the truth.
    expect(ratio('0.0000', '0.0000')).toBe(0)
    expect(ratio('25.0000', '0.0000')).toBe(1)
    expect(ratio('50.0000', '100.0000')).toBeCloseTo(0.5)
  })

  it('accepts a plan of zero but not a negative one', () => {
    expect(isValidPlan('0')).toBe(true)
    expect(isValidPlan('-1.00')).toBe(false)
    expect(isValidPlan('nonsense')).toBe(false)
  })
})

describe('carry-forward', () => {
  const line = (
    monthKey: string, planned: string, spent: string, rollover = true,
  ): HistoryEntry => ({ monthKey, planned, spent, rollover })

  it('accumulates an unspent balance for a sinking fund', () => {
    const balances = carryForward([
      line('2026-01', '100.0000', '0.0000'),
      line('2026-02', '100.0000', '20.0000'),
      line('2026-03', '100.0000', '0.0000'),
    ])

    expect(balances[1]?.carriedIn).toBe('100.0000')
    expect(balances[1]?.available).toBe('200.0000')
    // 100 in January, 100 more in February less 20 spent.
    expect(balances[2]?.carriedIn).toBe('180.0000')
    expect(balances[2]?.available).toBe('280.0000')
  })

  it('carries overspend forward as a negative', () => {
    const balances = carryForward([
      line('2026-01', '100.0000', '150.0000'),
      line('2026-02', '100.0000', '0.0000'),
    ])

    // Clamping this to zero would mean overdrawing a fund costs nothing next
    // month. A fund that refills itself when you overspend is not a fund.
    expect(balances[0]?.remaining).toBe('-50.0000')
    expect(balances[1]?.carriedIn).toBe('-50.0000')
    expect(balances[1]?.available).toBe('50.0000')
  })

  it('carries nothing at all when rollover is off', () => {
    const balances = carryForward([
      line('2026-01', '100.0000', '20.0000', false),
      line('2026-02', '100.0000', '0.0000', false),
    ])

    // A monthly allowance that accumulated would stop being an allowance.
    expect(balances[1]?.carriedIn).toBe('0.0000')
    expect(balances[1]?.available).toBe('100.0000')
  })

  it('breaks the chain across a month with no line', () => {
    const balances = carryForward([
      line('2026-01', '100.0000', '0.0000'),
      line('2026-03', '100.0000', '0.0000'),
    ])

    // February was never planned, so the envelope was not running. Carrying
    // January's balance over the gap would produce an opening figure the user
    // never saw.
    expect(balances[1]?.carriedIn).toBe('0.0000')
  })

  it('stops carrying when a line turns rollover off mid-history', () => {
    const balances = carryForward([
      line('2026-01', '100.0000', '0.0000', true),
      line('2026-02', '100.0000', '0.0000', false),
      line('2026-03', '100.0000', '0.0000', true),
    ])

    expect(balances[1]?.carriedIn).toBe('100.0000')
    expect(balances[2]?.carriedIn).toBe('0.0000')
  })

  it('recomputes from history, so a late transaction corrects every later month', () => {
    const before = carryForward([
      line('2026-01', '100.0000', '0.0000'),
      line('2026-02', '100.0000', '0.0000'),
    ])
    const after = carryForward([
      line('2026-01', '100.0000', '40.0000'),
      line('2026-02', '100.0000', '0.0000'),
    ])

    // Nothing is stored, so importing a January receipt in March fixes March
    // too. Persisting the carry-forward into the next row would overwrite the
    // input it was computed from.
    expect(before[1]?.available).toBe('200.0000')
    expect(after[1]?.available).toBe('160.0000')
  })

  it('finds one month without the caller walking the list', () => {
    const history = [line('2026-01', '100.0000', '25.0000'), line('2026-02', '50.0000', '0.0000')]
    expect(balanceFor(history, '2026-02')?.available).toBe('125.0000')
    expect(balanceFor(history, '2026-09')).toBeUndefined()
  })

  it('drafts from the plan, never from the available balance', () => {
    // Copying `available` would fold last month's leftover into next month's
    // plan, and the month after would carry it again — the same balance counted
    // twice, compounding.
    expect(draftPlannedFrom({ planned: '100.0000' })).toBe('100.0000')
  })

  it('totals a month of plans as text', () => {
    expect(totalPlanned([{ planned: '100.0000' }, { planned: '33.3300' }])).toBe('133.3300')
    expect(totalPlanned([])).toBe('0.0000')
  })
})

describe('pace and health', () => {
  const line = (planned: string, spent: string, rollover = false) => ({
    categoryId: 'c1',
    categoryName: 'Groceries',
    planned,
    available: planned,
    spent,
    remaining: subtractMoney(planned, spent),
    rollover,
  })

  it('calls the same number fine late in the month and a problem early', () => {
    const early = statusFor(line('400.0000', '320.0000'), '2026-03', '2026-03-10')
    const late = statusFor(line('400.0000', '320.0000'), '2026-03', '2026-03-28')

    // 80% spent. The whole reason a progress bar alone is not enough.
    expect(early.health).toBe('at-risk')
    expect(late.health).toBe('on-track')
  })

  it('calls a line over as soon as remaining is negative, whatever the date', () => {
    const status = statusFor(line('100.0000', '140.0000'), '2026-03', '2026-03-02')
    expect(status.health).toBe('over')
  })

  it('judges a finished month on its total, not on pace', () => {
    const status = statusFor(line('400.0000', '399.0000'), '2026-03', '2026-04-05')
    expect(status.health).toBe('on-track')
  })

  it('gives a future month no pace rather than dividing by zero', () => {
    const status = statusFor(line('400.0000', '0.0000'), '2026-05', '2026-03-10')
    expect(status.pace).toBe(0)
    expect(Number.isFinite(status.pace)).toBe(true)
  })

  it('caps pace rather than reporting infinity for a zero plan', () => {
    const status = statusFor(
      { ...line('0.0000', '50.0000'), available: '0.0000', remaining: '-50.0000' },
      '2026-03', '2026-03-10',
    )
    expect(Number.isFinite(status.pace)).toBe(true)
    expect(status.health).toBe('over')
  })

  it('marks an untouched line unused rather than ahead', () => {
    expect(statusFor(line('400.0000', '0.0000'), '2026-03', '2026-03-20').health).toBe('unused')
  })

  it('uses available, not planned, so a fund balance counts', () => {
    const fund = statusFor(
      { ...line('100.0000', '250.0000', true), available: '300.0000', remaining: '50.0000' },
      '2026-03', '2026-03-28',
    )
    // Spent well over the month's plan, but the envelope had two months of
    // savings in it. Judging against `planned` would cry wolf every time a
    // sinking fund is actually used.
    expect(fund.health).not.toBe('over')
    expect(fund.used).toBeCloseTo(250 / 300)
  })
})

describe('ranking for the dashboard', () => {
  const at = (name: string, planned: string, spent: string) =>
    statusFor(
      {
        categoryId: name, categoryName: name, planned, available: planned, spent,
        remaining: subtractMoney(planned, spent), rollover: false,
      },
      '2026-03', '2026-03-10',
    )

  it('puts overspent lines ahead of at-risk ones', () => {
    const ranked = rankAtRisk([at('Fine', '400.0000', '50.0000'), at('Risky', '400.0000', '320.0000'), at('Over', '100.0000', '140.0000')])
    expect(ranked.map((l) => l.categoryName)).toEqual(['Over', 'Risky'])
  })

  it('leaves healthy lines out entirely', () => {
    // A widget that lists everything is a table, and the dashboard has two.
    expect(rankAtRisk([at('Fine', '400.0000', '20.0000')])).toEqual([])
  })

  it('orders at-risk lines by how far past pace, not by size', () => {
    const big = at('Big', '4000.0000', '2000.0000')
    const small = at('Small', '40.0000', '39.0000')
    const ranked = rankAtRisk([big, small])
    // Small is nearly spent on the 10th; Big is at half. The larger number is
    // not the more urgent one.
    expect(ranked[0]?.categoryName).toBe('Small')
  })

  it('keeps the tile short', () => {
    const many = Array.from({ length: 9 }, (_, i) => at(`C${i}`, '100.0000', '200.0000'))
    expect(rankAtRisk(many).length).toBe(4)
    expect(rankAtRisk(many, 2).length).toBe(2)
  })

  it('agrees with the threshold it publishes', () => {
    // The UI colours a bar off AT_RISK_PACE; a constant the logic ignored would
    // make the colour and the ranking disagree.
    const justUnder = at('Under', '310.0000', '100.0000')
    expect(justUnder.pace).toBeLessThan(AT_RISK_PACE)
    expect(justUnder.health).not.toBe('at-risk')
  })
})

describe('the shape a plan is shown in', () => {
  it('shows two places, not the column\'s four', () => {
    // `450.0000` in a field a person types into tells them the database's
    // business rather than their own.
    expect(editableMoney('450.0000')).toBe('450.00')
    expect(editableMoney('0.0000')).toBe('0.00')
    expect(editableMoney('1234.5000')).toBe('1234.50')
    expect(editableMoney('0.0500')).toBe('0.05')
  })

  it('keeps real sub-cent precision rather than rounding it away', () => {
    // Trimming is presentation. Silently turning 0.1234 into 0.12 would change
    // a number the user entered.
    expect(editableMoney('0.1234')).toBe('0.1234')
  })

  it('round-trips through the parser unchanged', () => {
    for (const v of ['450.0000', '0.0000', '-12.5000', '0.1234']) {
      expect(parseMoney(editableMoney(v))).toBe(parseMoney(v))
    }
  })
})
