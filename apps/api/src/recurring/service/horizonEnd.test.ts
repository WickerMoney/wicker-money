import { describe, expect, it } from 'vitest'
import { addMonths } from './addMonths.js'
import { horizonEnd } from './horizonEnd.js'

describe('horizonEnd', () => {
  it.each([
    ['2026-10-02', '30d', '2026-11-01'],
    ['2026-10-02', '60d', '2026-12-01'],
    ['2026-10-02', '90d', '2026-12-31'],
    ['2026-10-02', '6m', '2027-04-02'],
    ['2026-10-02', 'eoy', '2026-12-31'],
    ['2026-12-30', 'eoy', '2026-12-31'],
    // On New Year's Eve "end of year" would be an empty chart; it means next year.
    ['2026-12-31', 'eoy', '2027-12-31'],
  ] as const)('from %s, %s ends on %s', (today, horizon, expected) => {
    expect(horizonEnd(today, horizon)).toBe(expected)
  })
})

describe('addMonths', () => {
  it.each([
    ['2026-08-31', 6, '2027-02-28'],
    ['2027-08-31', 6, '2028-02-29'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-11-15', 2, '2027-01-15'],
  ] as const)('%s + %i months is %s', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected)
  })
})
