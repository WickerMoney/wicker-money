import { describe, expect, it } from 'vitest'
import { dailyBalances, flowTotals, nextPayday } from './projection.js'
import { nextScheduledOccurrence, scheduledOccurrences } from './scheduled.js'
import type { RecurringItem } from './types.js'

/** Monthly rent on the 1st from checking. */
const rent: RecurringItem = {
  frequency: 'monthly', seriesStartDate: '2026-01-01', legs: [{ accountId: 'chk', amount: '-1500.0000' }],
}

/** Biweekly pay into checking, Fridays from 2026-10-02. */
const pay: RecurringItem = {
  frequency: 'biweekly', seriesStartDate: '2026-10-02', legs: [{ accountId: 'chk', amount: '2000.0000' }],
}

/** Dates and nominal dates of a list, for compact assertions. */
function brief(list: readonly { nominalDate: string; date: string }[]): string[] {
  return list.map((o) => (o.date === o.nominalDate ? o.date : `${o.nominalDate}->${o.date}`))
}

describe('scheduledOccurrences', () => {
  it('matches the plain schedule when nothing is overridden', () => {
    const found = scheduledOccurrences(rent, '2026-10-01', '2027-01-01')
    expect(brief(found)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
    expect(found[0]?.legs).toBe(rent.legs)
  })

  it('drops a skipped occurrence', () => {
    const item = { ...rent, overrides: { '2026-11-01': { skipped: true } } }
    expect(brief(scheduledOccurrences(item, '2026-10-01', '2027-01-01'))).toEqual(['2026-10-01', '2026-12-01'])
  })

  it('uses override legs for that occurrence only', () => {
    const legs = [{ accountId: 'chk', amount: '-1525.5000' }]
    const item = { ...rent, overrides: { '2026-11-01': { legs } } }
    const found = scheduledOccurrences(item, '2026-10-01', '2027-01-01')
    expect(found.map((o) => o.legs[0]?.amount)).toEqual(['-1500.0000', '-1525.5000', '-1500.0000'])
  })

  it('places a moved occurrence by the date it lands, in or out of the range', () => {
    const item = {
      ...rent,
      overrides: {
        '2026-11-01': { date: '2026-10-30' }, // earlier, still inside
        '2026-12-01': { date: '2027-01-04' }, // moved out of the range
        '2027-01-01': { date: '2026-12-31' }, // scheduled outside, moved in
      },
    }
    expect(brief(scheduledOccurrences(item, '2026-10-01', '2027-01-01')))
      .toEqual(['2026-10-01', '2026-11-01->2026-10-30', '2027-01-01->2026-12-31'])
  })

  it('carries a late occurrence from before the range into it', () => {
    const item = { ...rent, overrides: { '2026-10-01': { date: '2026-10-04' } } }
    expect(brief(scheduledOccurrences(item, '2026-10-04', '2026-10-10'))).toEqual(['2026-10-01->2026-10-04'])
  })

  it('ignores an override keyed by a date the schedule does not have', () => {
    const item = {
      ...rent,
      overrides: { '2026-10-15': { date: '2026-10-20' }, '2026-10-16': { legs: [] } },
    }
    expect(brief(scheduledOccurrences(item, '2026-10-01', '2026-11-01'))).toEqual(['2026-10-01'])
  })

  it('keeps an occurrence with no legs listed: it happens, it just moves nothing', () => {
    const item = { ...rent, overrides: { '2026-10-01': { legs: [] } } }
    const found = scheduledOccurrences(item, '2026-10-01', '2026-10-02')
    expect(found).toEqual([{ nominalDate: '2026-10-01', date: '2026-10-01', legs: [] }])
  })

  it('orders by landing date, then nominal date', () => {
    const item = { ...rent, overrides: { '2026-11-01': { date: '2026-10-01' } } }
    expect(brief(scheduledOccurrences(item, '2026-10-01', '2026-12-01')))
      .toEqual(['2026-10-01', '2026-11-01->2026-10-01'])
  })

  it('throws on a malformed override date rather than dropping the occurrence', () => {
    const item = { ...rent, overrides: { '2026-10-01': { date: '2026-13-01' } } }
    expect(() => scheduledOccurrences(item, '2026-10-01', '2026-11-01')).toThrow(RangeError)
  })
})

describe('nextScheduledOccurrence', () => {
  it('is the plain next occurrence without overrides', () => {
    expect(nextScheduledOccurrence(rent, '2026-10-02')?.date).toBe('2026-11-01')
  })

  it('passes over skipped occurrences and ones with no legs left', () => {
    const item = {
      ...rent,
      overrides: { '2026-11-01': { skipped: true }, '2026-12-01': { legs: [] } },
    }
    expect(nextScheduledOccurrence(item, '2026-10-02')).toEqual({
      nominalDate: '2027-01-01', date: '2027-01-01', legs: rent.legs,
    })
  })

  it('finds an occurrence moved forward past the range start', () => {
    const item = { ...rent, overrides: { '2026-10-01': { date: '2026-10-05' } } }
    expect(nextScheduledOccurrence(item, '2026-10-02')?.nominalDate).toBe('2026-10-01')
  })

  it('finds an occurrence moved earlier than the next nominal one', () => {
    const item = { ...rent, overrides: { '2026-12-01': { date: '2026-10-20' } } }
    expect(nextScheduledOccurrence(item, '2026-10-02')?.date).toBe('2026-10-20')
  })

  it('returns null once the series has ended', () => {
    expect(nextScheduledOccurrence({ ...rent, endDate: '2026-10-01' }, '2026-10-02')).toBeNull()
  })
})

describe('projections with overrides', () => {
  it('does not count a paycheck twice when it already arrived early', () => {
    // Today is Thursday 10-01 and Friday's pay landed today, so the balance has it.
    const arrived = { ...pay, overrides: { '2026-10-02': { legs: [] } } }
    const series = dailyBalances([arrived], { chk: '2500.0000' }, '2026-10-02', '2026-10-03')
    expect(series['chk']?.[0]?.balance).toBe('2500.0000')
  })

  it('applies a late bill on the day it is now expected', () => {
    const late = { ...rent, overrides: { '2026-10-01': { date: '2026-10-04' } } }
    const series = dailyBalances([late], { chk: '2000.0000' }, '2026-10-04', '2026-10-05')
    expect(series['chk']?.[0]).toEqual({ date: '2026-10-04', balance: '500.0000', low: '500.0000' })
  })

  it('nets each occurrence on its own legs in flowTotals', () => {
    const item = { ...rent, overrides: { '2026-11-01': { legs: [{ accountId: 'chk', amount: '-100.0000' }] } } }
    expect(flowTotals([item], ['chk'], '2026-10-01', '2026-12-01').outflow).toBe('-1600.0000')
  })

  it('moves the payday when the paycheck is skipped, moved or already here', () => {
    expect(nextPayday([pay], '2026-10-01')).toBe('2026-10-02')
    expect(nextPayday([{ ...pay, overrides: { '2026-10-02': { legs: [] } } }], '2026-10-01')).toBe('2026-10-16')
    expect(nextPayday([{ ...pay, overrides: { '2026-10-02': { skipped: true } } }], '2026-10-01')).toBe('2026-10-16')
    expect(nextPayday([{ ...pay, overrides: { '2026-10-02': { date: '2026-10-05' } } }], '2026-10-01')).toBe('2026-10-05')
  })

  it('keeps payday on a split paycheck when only one side has arrived', () => {
    const split: RecurringItem = {
      ...pay,
      legs: [{ accountId: 'chk', amount: '1500.0000' }, { accountId: 'sav', amount: '500.0000' }],
      overrides: { '2026-10-02': { legs: [{ accountId: 'sav', amount: '500.0000' }] } },
    }
    expect(nextPayday([split], '2026-10-01')).toBe('2026-10-02')
  })
})
