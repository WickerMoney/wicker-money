import { describe, expect, it } from 'vitest'
import { addDays, addMonths } from './index.js'

describe('addDays', () => {
  it.each([
    ['2026-10-09', 0, '2026-10-09'],
    ['2026-10-09', 1, '2026-10-10'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-01-01', 365, '2027-01-01'],
    ['2028-01-01', 366, '2029-01-01'],
    ['2026-01-01', -400, '2024-11-27'],
    // Daylight saving changes in most zones; a calendar date has no zone.
    ['2026-03-08', 1, '2026-03-09'],
    ['2026-11-01', 1, '2026-11-02'],
  ] as const)('%s + %i days is %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })

  it('undoes itself', () => {
    expect(addDays(addDays('2026-10-09', 800), -800)).toBe('2026-10-09')
  })

  it.each(['', '2026-10-9', '2026/10/09', '2026-02-30', '2026-13-01', '2026-10-09T00:00:00Z', 'not a date'])(
    'rejects the date %j',
    (date) => {
      expect(() => addDays(date, 1)).toThrow(RangeError)
    },
  )

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s days', (days) => {
    expect(() => addDays('2026-10-09', days)).toThrow(RangeError)
  })
})

describe('addMonths', () => {
  it.each([
    ['2026-08-31', 6, '2027-02-28'],
    ['2027-08-31', 6, '2028-02-29'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-01-31', 2, '2026-03-31'],
    ['2026-01-30', 1, '2026-02-28'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2028-03-31', -1, '2028-02-29'],
    ['2026-05-31', -1, '2026-04-30'],
    ['2026-11-15', 2, '2027-01-15'],
    ['2026-12-31', 1, '2027-01-31'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-01-15', -13, '2024-12-15'],
    ['2026-10-09', 12, '2027-10-09'],
    ['2026-10-09', -24, '2024-10-09'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
    ['2026-10-09', 0, '2026-10-09'],
  ] as const)('%s + %i months is %s', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected)
  })

  it('clamps each call on its own, so add the total rather than stepping', () => {
    expect(addMonths(addMonths('2026-01-31', 1), 1)).toBe('2026-03-28')
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31')
  })

  it.each(['', '2026-10-9', '2026-02-29', '2026-00-10', '2026-10-32', 'soon'])('rejects the date %j', (date) => {
    expect(() => addMonths(date, 1)).toThrow(RangeError)
  })

  it.each([0.5, Number.NaN, Number.NEGATIVE_INFINITY])('rejects %s months', (months) => {
    expect(() => addMonths('2026-10-09', months)).toThrow(RangeError)
  })
})
