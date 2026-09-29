import { describe, expect, it } from 'vitest'
import { nextOccurrence, occurrences } from './schedule.js'
import { RECURRENCE_FREQUENCIES, type RecurrenceFrequency, type RecurrenceSchedule } from './types.js'

/** Shorthand for a schedule. */
function s(
  frequency: RecurrenceFrequency,
  seriesStartDate: string,
  extra: Partial<RecurrenceSchedule> = {},
): RecurrenceSchedule {
  return { frequency, seriesStartDate, ...extra }
}

describe('once', () => {
  it('occurs exactly on its anchor', () => {
    expect(occurrences(s('once', '2026-10-05'), '2026-10-01', '2026-11-01')).toEqual(['2026-10-05'])
  })

  it('is absent from a range that does not contain it', () => {
    expect(occurrences(s('once', '2026-10-05'), '2026-10-06', '2027-01-01')).toEqual([])
    expect(occurrences(s('once', '2026-10-05'), '2026-01-01', '2026-10-05')).toEqual([])
  })

  it('has no next occurrence once it has passed', () => {
    expect(nextOccurrence(s('once', '2026-10-05'), '2026-10-05')).toBe('2026-10-05')
    expect(nextOccurrence(s('once', '2026-10-05'), '2026-10-06')).toBeNull()
  })
})

describe('day-stepped frequencies', () => {
  it('steps daily from the anchor', () => {
    expect(occurrences(s('daily', '2026-09-28'), '2026-09-27', '2026-10-01'))
      .toEqual(['2026-09-28', '2026-09-29', '2026-09-30'])
  })

  it('keeps the anchor weekday for weekly', () => {
    // 2026-09-28 is a Monday.
    expect(occurrences(s('weekly', '2026-09-28'), '2026-10-01', '2026-10-20'))
      .toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
  })

  it('crosses a year boundary biweekly without drifting', () => {
    expect(occurrences(s('biweekly', '2025-12-19'), '2025-12-01', '2026-02-01'))
      .toEqual(['2025-12-19', '2026-01-02', '2026-01-16', '2026-01-30'])
  })

  it('crosses a leap day biweekly', () => {
    expect(occurrences(s('biweekly', '2028-02-15'), '2028-02-01', '2028-03-15'))
      .toEqual(['2028-02-15', '2028-02-29', '2028-03-14'])
  })

  it('jumps straight to a range years after the anchor', () => {
    // 2020-01-03 + 14n: 2026-10-02 is n = 176 (2,464 days, checked independently).
    expect(occurrences(s('biweekly', '2020-01-03'), '2026-09-20', '2026-10-20'))
      .toEqual(['2026-10-02', '2026-10-16'])
  })
})

describe('month-stepped frequencies', () => {
  it('clamps a 31st to short months and recovers, computed from the anchor', () => {
    expect(occurrences(s('monthly', '2026-01-31'), '2026-01-01', '2026-06-01'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  })

  it('uses February 29th in a leap year', () => {
    expect(occurrences(s('monthly', '2028-01-30'), '2028-02-01', '2028-04-01'))
      .toEqual(['2028-02-29', '2028-03-30'])
  })

  it('clamps quarterly from a 30th', () => {
    expect(occurrences(s('quarterly', '2025-11-30'), '2025-11-01', '2026-09-01'))
      .toEqual(['2025-11-30', '2026-02-28', '2026-05-30', '2026-08-30'])
  })

  it('clamps an annual February 29th to the 28th, and returns to the 29th in leap years', () => {
    expect(occurrences(s('annual', '2024-02-29'), '2024-01-01', '2029-01-01'))
      .toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  })

  it('crosses a year boundary monthly', () => {
    expect(occurrences(s('monthly', '2026-11-15'), '2026-11-01', '2027-02-01'))
      .toEqual(['2026-11-15', '2026-12-15', '2027-01-15'])
  })
})

describe('semimonthly', () => {
  it('defaults to the 1st and 15th', () => {
    expect(occurrences(s('semimonthly', '2026-10-01'), '2026-10-01', '2026-12-01'))
      .toEqual(['2026-10-01', '2026-10-15', '2026-11-01', '2026-11-15'])
  })

  it('treats 31 as "the last day" in every month', () => {
    const lastDay = s('semimonthly', '2026-01-01', { semimonthlyDays: [15, 31] })
    expect(occurrences(lastDay, '2026-01-01', '2026-05-01')).toEqual([
      '2026-01-15', '2026-01-31', '2026-02-15', '2026-02-28',
      '2026-03-15', '2026-03-31', '2026-04-15', '2026-04-30',
    ])
  })

  it('uses Feb 29th for "last day" in a leap year', () => {
    const lastDay = s('semimonthly', '2028-01-01', { semimonthlyDays: [15, 31] })
    expect(occurrences(lastDay, '2028-02-01', '2028-03-01')).toEqual(['2028-02-15', '2028-02-29'])
  })

  it('handles arbitrary pairs such as the 5th and 20th', () => {
    const pair = s('semimonthly', '2026-10-01', { semimonthlyDays: [5, 20] })
    expect(occurrences(pair, '2026-10-01', '2026-11-10')).toEqual(['2026-10-05', '2026-10-20', '2026-11-05'])
  })

  it('accepts the days in either order', () => {
    const a = s('semimonthly', '2026-10-01', { semimonthlyDays: [20, 5] })
    const b = s('semimonthly', '2026-10-01', { semimonthlyDays: [5, 20] })
    expect(occurrences(a, '2026-10-01', '2027-01-01')).toEqual(occurrences(b, '2026-10-01', '2027-01-01'))
  })

  it('skips a day that falls before a mid-month anchor', () => {
    expect(occurrences(s('semimonthly', '2026-10-10'), '2026-10-01', '2026-11-02'))
      .toEqual(['2026-10-15', '2026-11-01'])
  })

  it('keeps 27 and 31 distinct in February', () => {
    const pair = s('semimonthly', '2026-01-01', { semimonthlyDays: [27, 31] })
    expect(occurrences(pair, '2026-02-01', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28'])
  })

  it.each([
    [[0, 15]], [[1, 32]], [[1.5, 15]], [[15, 15]],
    // Both clamp to Feb 28th and would become one payment.
    [[28, 31]], [[29, 30]],
  ] as const)('refuses days %j', (days) => {
    expect(() => occurrences(s('semimonthly', '2026-01-01', { semimonthlyDays: days }), '2026-01-01', '2026-02-01'))
      .toThrow(RangeError)
  })

  it('ignores semimonthlyDays for other frequencies', () => {
    expect(occurrences(s('monthly', '2026-10-03', { semimonthlyDays: [1, 15] }), '2026-10-01', '2026-11-01'))
      .toEqual(['2026-10-03'])
  })
})

describe('end date', () => {
  it('includes an occurrence exactly on the end date', () => {
    const item = s('monthly', '2026-01-10', { endDate: '2026-03-10' })
    expect(occurrences(item, '2026-01-01', '2027-01-01')).toEqual(['2026-01-10', '2026-02-10', '2026-03-10'])
  })

  it('stops between occurrences', () => {
    const item = s('weekly', '2026-10-05', { endDate: '2026-10-18' })
    expect(occurrences(item, '2026-10-01', '2026-12-01')).toEqual(['2026-10-05', '2026-10-12'])
  })

  it('stops semimonthly mid-month', () => {
    const item = s('semimonthly', '2026-10-01', { endDate: '2026-11-10' })
    expect(occurrences(item, '2026-10-01', '2027-01-01')).toEqual(['2026-10-01', '2026-10-15', '2026-11-01'])
  })

  it('allows a one-day series (end equals start)', () => {
    expect(occurrences(s('daily', '2026-10-05', { endDate: '2026-10-05' }), '2026-10-01', '2026-11-01'))
      .toEqual(['2026-10-05'])
  })

  it('has no next occurrence after it', () => {
    expect(nextOccurrence(s('monthly', '2026-01-10', { endDate: '2026-03-10' }), '2026-03-11')).toBeNull()
  })

  it('treats null as open-ended', () => {
    expect(nextOccurrence(s('annual', '2000-06-01', { endDate: null }), '2026-09-28')).toBe('2027-06-01')
  })
})

describe('ranges', () => {
  it('is half-open: includes from, excludes to', () => {
    expect(occurrences(s('daily', '2026-10-01'), '2026-10-02', '2026-10-04')).toEqual(['2026-10-02', '2026-10-03'])
  })

  it('is empty when from equals to', () => {
    expect(occurrences(s('daily', '2026-10-01'), '2026-10-02', '2026-10-02')).toEqual([])
  })

  it('never yields a date before the anchor', () => {
    expect(occurrences(s('monthly', '2026-10-15'), '2020-01-01', '2026-11-01')).toEqual(['2026-10-15'])
  })

  it('refuses a range that ends before it starts', () => {
    expect(() => occurrences(s('daily', '2026-10-01'), '2026-10-05', '2026-10-04')).toThrow(RangeError)
  })
})

describe('next occurrence', () => {
  it('includes the from date itself', () => {
    expect(nextOccurrence(s('monthly', '2026-01-28'), '2026-09-28')).toBe('2026-09-28')
  })

  it('is derived from the anchor, never the anchor itself', () => {
    // The old app showed a year-old anchor as "Due"; this is the fix.
    expect(nextOccurrence(s('monthly', '2025-01-31'), '2026-09-28')).toBe('2026-09-30')
    expect(nextOccurrence(s('quarterly', '2025-11-30'), '2026-09-28')).toBe('2026-11-30')
  })

  it('returns the anchor for a series that has not started', () => {
    expect(nextOccurrence(s('weekly', '2027-01-04'), '2026-09-28')).toBe('2027-01-04')
  })
})

describe('invalid input throws rather than skipping', () => {
  it.each(['fortnightly', 'toString', '', 'MONTHLY'])('unknown frequency %j', (frequency) => {
    const item = { frequency, seriesStartDate: '2026-01-01' } as unknown as RecurrenceSchedule
    expect(() => occurrences(item, '2026-01-01', '2026-02-01')).toThrow(/Unknown recurrence frequency/)
    expect(() => nextOccurrence(item, '2026-01-01')).toThrow(/Unknown recurrence frequency/)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-2-3', '2026-02-03T00:00:00Z', ''])('invalid date %j', (date) => {
    expect(() => occurrences(s('daily', date), '2026-01-01', '2026-02-01')).toThrow(RangeError)
    expect(() => occurrences(s('daily', '2026-01-01'), date, '2026-02-01')).toThrow(RangeError)
  })

  it('an end date before the start', () => {
    expect(() => nextOccurrence(s('monthly', '2026-05-01', { endDate: '2026-04-30' }), '2026-01-01'))
      .toThrow(RangeError)
  })

  it('covers every frequency the type declares', () => {
    for (const frequency of RECURRENCE_FREQUENCIES) {
      expect(() => occurrences(s(frequency, '2026-01-01'), '2026-01-01', '2027-01-01')).not.toThrow()
    }
  })
})

describe('properties', () => {
  // A small seeded PRNG so failures reproduce; no dependency needed.
  function rng(seed: number): () => number {
    let x = seed
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648
      return x / 2147483648
    }
  }
  const random = rng(20260928)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T
  const dateAt = (offset: number): string => new Date(Date.UTC(2020, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10)

  const cases = Array.from({ length: 400 }, () => {
    const frequency = pick(RECURRENCE_FREQUENCIES)
    const start = Math.floor(random() * 3000)
    const d1 = 1 + Math.floor(random() * 27)
    const d2 = d1 + 1 + Math.floor(random() * (31 - d1))
    const schedule: RecurrenceSchedule = {
      frequency,
      seriesStartDate: dateAt(start),
      endDate: random() < 0.3 ? dateAt(start + Math.floor(random() * 800)) : null,
      semimonthlyDays: [d1, d2],
    }
    const from = Math.floor(random() * 3500)
    const to = from + Math.floor(random() * 120)
    return { schedule, from: dateAt(from), to: dateAt(to) }
  })

  /**
   * A deliberately naive oracle: walk every day and test it against the rule
   * as the decisions doc states it. Shares no code with the implementation.
   */
  function oracle(schedule: RecurrenceSchedule, from: string, to: string): string[] {
    const out: string[] = []
    const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
    const [ay, am, ad] = schedule.seriesStartDate.split('-').map(Number) as [number, number, number]
    const anchorMs = Date.UTC(ay, am - 1, ad)
    const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
    for (let ms = Date.UTC(fy, fm - 1, fd); ; ms += 86_400_000) {
      const date = new Date(ms).toISOString().slice(0, 10)
      if (date >= to) break
      if (date < from || date < schedule.seriesStartDate) continue
      if (schedule.endDate && date > schedule.endDate) break
      const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const d = Number(date.slice(8, 10))
      const daysSince = Math.round((ms - anchorMs) / 86_400_000)
      const monthsSince = (y * 12 + m) - (ay * 12 + am)
      const hit = {
        once: daysSince === 0,
        daily: true,
        weekly: daysSince % 7 === 0,
        biweekly: daysSince % 14 === 0,
        monthly: d === Math.min(ad, dim(y, m)),
        quarterly: monthsSince % 3 === 0 && d === Math.min(ad, dim(y, m)),
        annual: monthsSince % 12 === 0 && d === Math.min(ad, dim(y, m)),
        semimonthly: (schedule.semimonthlyDays ?? [1, 15]).some((sd) => d === Math.min(sd, dim(y, m))),
      }[schedule.frequency]
      if (hit) out.push(date)
    }
    return out
  }

  it('matches a day-by-day oracle of the stated rules', () => {
    for (const { schedule, from, to } of cases) {
      expect(occurrences(schedule, from, to), JSON.stringify({ schedule, from, to })).toEqual(oracle(schedule, from, to))
    }
  })

  it('a window agrees with filtering the whole series (jump-ahead is exact)', () => {
    for (const { schedule, from, to } of cases) {
      const whole = occurrences(schedule, '2019-01-01', '2031-01-01')
      expect(occurrences(schedule, from, to), JSON.stringify({ schedule, from, to }))
        .toEqual(whole.filter((d) => d >= from && d < to))
    }
  })

  it('is strictly ascending, inside the series, and nextOccurrence is its first element', () => {
    for (const { schedule, from, to } of cases) {
      const dates = occurrences(schedule, from, to)
      for (let i = 1; i < dates.length; i += 1) expect(dates[i]! > dates[i - 1]!).toBe(true)
      for (const d of dates) {
        expect(d >= schedule.seriesStartDate).toBe(true)
        if (schedule.endDate) expect(d <= schedule.endDate).toBe(true)
      }
      const next = nextOccurrence(schedule, from)
      if (dates.length > 0) expect(next).toBe(dates[0])
      else if (next !== null) expect(next >= to).toBe(true)
    }
  })
})
