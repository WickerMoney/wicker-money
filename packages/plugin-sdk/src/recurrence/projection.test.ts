import { describe, expect, it } from 'vitest'
import {
  dailyBalances, flowTotals, monthlyEquivalent, nextPayday,
} from './projection.js'
import type { RecurrenceFrequency, RecurringItem } from './types.js'

/** A one-leg item. */
function item(
  frequency: RecurrenceFrequency,
  seriesStartDate: string,
  accountId: string,
  amount: string,
  extra: Partial<RecurringItem> = {},
): RecurringItem {
  return { frequency, seriesStartDate, legs: [{ accountId, amount }], ...extra }
}

/** A two-leg transfer that nets to zero. */
function transfer(
  frequency: RecurrenceFrequency,
  seriesStartDate: string,
  fromAccount: string,
  toAccount: string,
  amount: string,
): RecurringItem {
  return {
    frequency,
    seriesStartDate,
    legs: [{ accountId: fromAccount, amount: `-${amount}` }, { accountId: toAccount, amount }],
  }
}

/** The balance series for one account as `date → balance`. */
function asMap(series: Record<string, { date: string; balance: string }[]>, accountId: string): Record<string, string> {
  return Object.fromEntries((series[accountId] ?? []).map((d) => [d.date, d.balance]))
}

describe('monthlyEquivalent', () => {
  it('uses exact factors: $370 biweekly is $801.67, not the old ×2.17 $802.90', () => {
    expect(monthlyEquivalent('370.0000', 'biweekly')).toBe('801.6667')
    expect(monthlyEquivalent('-370.0000', 'biweekly')).toBe('-801.6667')
  })

  it.each([
    ['100', 'weekly', '433.3333'],
    ['450.0000', 'semimonthly', '900.0000'],
    ['1550', 'monthly', '1550.0000'],
    ['410', 'quarterly', '136.6667'],
    ['139', 'annual', '11.5833'],
    ['3.5', 'daily', '106.4583'],
    ['0.1', 'weekly', '0.4333'],
  ] as const)('%s %s → %s', (amount, frequency, expected) => {
    expect(monthlyEquivalent(amount, frequency)).toBe(expected)
  })

  it('rounds half away from zero, symmetrically', () => {
    // 0.0006 * 1/12 = 0.00005 exactly: the half case.
    expect(monthlyEquivalent('0.0006', 'annual')).toBe('0.0001')
    expect(monthlyEquivalent('-0.0006', 'annual')).toBe('-0.0001')
  })

  it('gives a one-off no monthly rate', () => {
    expect(monthlyEquivalent('-900', 'once')).toBe('0.0000')
  })

  it('stays exact for large amounts', () => {
    expect(monthlyEquivalent('123456789012345.6789', 'monthly')).toBe('123456789012345.6789')
  })

  it('throws on an unknown frequency or a non-decimal amount', () => {
    expect(() => monthlyEquivalent('10', 'fortnightly' as RecurrenceFrequency)).toThrow(/Unknown recurrence frequency/)
    expect(() => monthlyEquivalent('10', 'constructor' as RecurrenceFrequency)).toThrow(/Unknown recurrence frequency/)
    expect(() => monthlyEquivalent('1e3', 'monthly')).toThrow(RangeError)
    expect(() => monthlyEquivalent('$10', 'monthly')).toThrow(RangeError)
  })
})

describe('nextPayday', () => {
  const today = '2026-09-28'

  it('is strictly after today: income that landed today is already in the balance', () => {
    const pay = item('biweekly', '2026-09-28', 'checking', '2850')
    expect(nextPayday([pay], today)).toBe('2026-10-12')
  })

  it('takes the earliest of several incomes (two offset biweekly paychecks)', () => {
    const a = item('biweekly', '2026-09-18', 'checking', '2100')     // next: Oct 2
    const b = item('biweekly', '2026-09-25', 'joint', '1900')        // next: Oct 9
    expect(nextPayday([a, b], today)).toBe('2026-10-02')
    expect(nextPayday([b], today)).toBe('2026-10-09')
  })

  it('counts a split paycheck (several positive legs) as income', () => {
    const split: RecurringItem = {
      frequency: 'semimonthly',
      seriesStartDate: '2026-01-01',
      semimonthlyDays: [15, 31],
      legs: [{ accountId: 'monthly-expenses', amount: '1800' }, { accountId: 'yearly-expenses', amount: '400' }],
    }
    expect(nextPayday([split], today)).toBe('2026-09-30')
  })

  it('ignores bills and transfers, even a transfer into checking', () => {
    const rent = item('monthly', '2026-01-29', 'checking', '-1550')
    const topUp = transfer('weekly', '2026-09-29', 'savings', 'checking', '50')
    expect(nextPayday([rent, topUp], today)).toBeNull()
  })

  it('ignores income that has ended', () => {
    const oldJob = item('biweekly', '2025-01-03', 'checking', '2000', { endDate: '2026-09-01' })
    expect(nextPayday([oldJob], today)).toBeNull()
  })

  it('is null with no items at all', () => {
    expect(nextPayday([], today)).toBeNull()
  })
})

describe('dailyBalances', () => {
  it('does not double count today: starts from today\'s balance and projects from tomorrow', () => {
    const rentToday = item('monthly', '2026-01-28', 'checking', '-1550')   // due today, already posted
    const phone = item('monthly', '2026-01-29', 'checking', '-80')         // due tomorrow
    const series = dailyBalances([rentToday, phone], { checking: '1000.0000' }, '2026-09-29', '2026-10-02')
    expect(series.checking).toEqual([
      { date: '2026-09-29', balance: '920.0000', low: '920.0000' },
      { date: '2026-09-30', balance: '920.0000', low: '920.0000' },
      { date: '2026-10-01', balance: '920.0000', low: '920.0000' },
    ])
  })

  it('reports a day\'s low point with its outflows cleared before its inflows land', () => {
    // Rent and the paycheck on the same day: the end of the day looks fine,
    // the middle of it does not.
    const rent = item('monthly', '2026-01-01', 'checking', '-1550')
    const pay = item('monthly', '2026-01-01', 'checking', '2000')
    const series = dailyBalances([rent, pay], { checking: '400' }, '2026-10-01', '2026-10-02')
    expect(series.checking?.[0]).toEqual({ date: '2026-10-01', balance: '850.0000', low: '-1150.0000' })
  })

  it('carries the previous end-of-day balance into the next day\'s low', () => {
    const pay = item('monthly', '2026-01-01', 'checking', '1000')
    const phone = item('monthly', '2026-01-02', 'checking', '-80')
    const series = dailyBalances([pay, phone], { checking: '0' }, '2026-10-01', '2026-10-03')
    expect(series.checking).toEqual([
      { date: '2026-10-01', balance: '1000.0000', low: '0.0000' },
      { date: '2026-10-02', balance: '920.0000', low: '920.0000' },
    ])
  })

  it('applies a transfer\'s outgoing leg to the low and its incoming leg after it', () => {
    const toSavings = transfer('monthly', '2026-01-01', 'checking', 'savings', '200')
    const series = dailyBalances([toSavings], { checking: '100', savings: '0' }, '2026-10-01', '2026-10-02')
    expect(series.checking?.[0]).toMatchObject({ balance: '-100.0000', low: '-100.0000' })
    expect(series.savings?.[0]).toMatchObject({ balance: '200.0000', low: '0.0000' })
  })

  it('fills every day, including days with no activity', () => {
    const series = dailyBalances([], { checking: '5' }, '2026-02-01', '2026-03-01')
    expect(series.checking).toHaveLength(28)
    expect(series.checking?.every((d) => d.balance === '5.0000')).toBe(true)
  })

  it('applies both legs of a transfer with the right sign on each account', () => {
    const toSavings = transfer('monthly', '2026-01-01', 'checking', 'savings', '200')
    const series = dailyBalances([toSavings], { checking: '1000', savings: '50' }, '2026-10-01', '2026-10-02')
    expect(series.checking?.[0]?.balance).toBe('800.0000')
    expect(series.savings?.[0]?.balance).toBe('250.0000')
  })

  it('applies a transfer to a listed account even when the other side is not listed', () => {
    const cardPayment = transfer('monthly', '2026-01-05', 'checking', 'credit-card', '400')
    const series = dailyBalances([cardPayment], { checking: '1000' }, '2026-10-01', '2026-10-06')
    expect(asMap(series, 'checking')['2026-10-05']).toBe('600.0000')
    expect(series['credit-card']).toBeUndefined()
  })

  it('splits a paycheck across accounts', () => {
    const split: RecurringItem = {
      frequency: 'biweekly',
      seriesStartDate: '2026-10-02',
      legs: [{ accountId: 'monthly', amount: '1800.5000' }, { accountId: 'yearly', amount: '400.2500' }],
    }
    const series = dailyBalances([split], { monthly: '0', yearly: '0' }, '2026-10-01', '2026-10-17')
    expect(asMap(series, 'monthly')['2026-10-16']).toBe('3601.0000')
    expect(asMap(series, 'yearly')['2026-10-16']).toBe('800.5000')
  })

  it('goes negative rather than stopping at zero', () => {
    const rent = item('monthly', '2026-01-01', 'checking', '-1550')
    const series = dailyBalances([rent], { checking: '100' }, '2026-10-01', '2026-10-02')
    expect(series.checking?.[0]?.balance).toBe('-1450.0000')
  })

  it('sums several items on the same day exactly', () => {
    const items = [
      item('monthly', '2026-01-01', 'checking', '-0.1'),
      item('monthly', '2026-01-01', 'checking', '-0.2'),
    ]
    const series = dailyBalances(items, { checking: '0.3' }, '2026-10-01', '2026-10-02')
    expect(series.checking?.[0]?.balance).toBe('0.0000')
  })

  it('returns empty series for an empty range and throws for a reversed one', () => {
    expect(dailyBalances([], { checking: '1' }, '2026-10-01', '2026-10-01')).toEqual({ checking: [] })
    expect(() => dailyBalances([], { checking: '1' }, '2026-10-02', '2026-10-01')).toThrow(RangeError)
  })

  it('throws on a malformed amount rather than skipping the leg', () => {
    const bad = item('monthly', '2026-01-01', 'elsewhere', 'abc')
    expect(() => dailyBalances([bad], { checking: '1' }, '2026-10-01', '2026-10-02')).toThrow(RangeError)
    expect(() => dailyBalances([], { checking: '1,000' }, '2026-10-01', '2026-10-02')).toThrow(RangeError)
  })
})

describe('flowTotals', () => {
  const from = '2026-10-01'
  const to = '2026-11-01'

  it('does not count a savings transfer as household spending', () => {
    const rent = item('monthly', '2026-01-01', 'checking', '-1550')
    const toSavings = transfer('monthly', '2026-01-15', 'checking', 'savings', '300')
    const household = flowTotals([rent, toSavings], ['checking', 'savings'], from, to)
    expect(household).toEqual({ inflow: '0.0000', outflow: '-1550.0000', net: '-1550.0000' })
  })

  it('does count the same transfer when measuring checking alone', () => {
    const toSavings = transfer('monthly', '2026-01-15', 'checking', 'savings', '300')
    expect(flowTotals([toSavings], ['checking'], from, to).outflow).toBe('-300.0000')
    expect(flowTotals([toSavings], ['savings'], from, to).inflow).toBe('300.0000')
  })

  it('counts a loan payment as an outflow from the cash accounts', () => {
    const car = transfer('monthly', '2026-01-10', 'checking', 'auto-loan', '425')
    expect(flowTotals([car], ['checking', 'savings'], from, to).outflow).toBe('-425.0000')
  })

  it('multiplies by occurrences in the range', () => {
    const pay = item('biweekly', '2026-10-02', 'checking', '2850')
    const rent = item('monthly', '2026-01-01', 'checking', '-1550')
    expect(flowTotals([pay, rent], ['checking'], from, to))
      .toEqual({ inflow: '8550.0000', outflow: '-1550.0000', net: '7000.0000' })
  })

  it('is all zeros for an empty account set', () => {
    const pay = item('biweekly', '2026-10-02', 'checking', '2850')
    expect(flowTotals([pay], [], from, to)).toEqual({ inflow: '0.0000', outflow: '0.0000', net: '0.0000' })
  })
})

describe('household scenario: Monthly Expenses + Yearly Expenses checking', () => {
  // Modelled on the seed persona the decisions doc asks for.
  const today = '2026-09-28'
  const items: RecurringItem[] = [
    // Split paycheck on the 15th and last day.
    {
      frequency: 'semimonthly', seriesStartDate: '2026-01-01', semimonthlyDays: [15, 31],
      legs: [{ accountId: 'monthly', amount: '1500' }, { accountId: 'yearly', amount: '300' }],
    },
    // Partner paid biweekly, offset.
    item('biweekly', '2026-09-25', 'monthly', '1100'),
    item('monthly', '2026-01-01', 'monthly', '-1550'),                  // rent on the 1st
    item('annual', '2025-10-03', 'yearly', '-1200'),                    // insurance, from Yearly
    transfer('monthly', '2026-01-02', 'monthly', 'savings', '250'),     // sinking fund
  ]

  it('finds the household payday from either income', () => {
    expect(nextPayday(items, today)).toBe('2026-09-30')
    expect(nextPayday(items, '2026-09-30')).toBe('2026-10-09')
  })

  it('keeps each checking account on its own: Yearly never covers Monthly', () => {
    const series = dailyBalances(items, { monthly: '400', yearly: '1000', savings: '0' }, '2026-09-29', '2026-10-10')
    const monthly = asMap(series, 'monthly')
    const yearly = asMap(series, 'yearly')
    expect(monthly['2026-09-30']).toBe('1900.0000')     // +1500
    expect(monthly['2026-10-01']).toBe('350.0000')      // -1550 rent
    expect(monthly['2026-10-02']).toBe('100.0000')      // -250 to savings
    expect(monthly['2026-10-09']).toBe('1200.0000')     // +1100 partner
    expect(yearly['2026-09-30']).toBe('1300.0000')      // +300
    expect(yearly['2026-10-03']).toBe('100.0000')       // -1200 insurance
    expect(asMap(series, 'savings')['2026-10-02']).toBe('250.0000')
  })

  it('does not treat the sinking-fund transfer as spending', () => {
    const totals = flowTotals(items, ['monthly', 'yearly', 'savings'], '2026-10-01', '2026-11-01')
    expect(totals.outflow).toBe('-2750.0000')           // rent + insurance only
  })
})
