import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RANGE_KEY, RANGE_KEYS, isRangeKey, monthsInRange, resolveRange,
} from './range.js'

describe('resolving a dashboard range', () => {
  it('covers whole months including the current one', () => {
    const r = resolveRange('3m', '2026-09-18')
    // July, August, September — not "ninety days back from the 18th".
    expect(r.from).toBe('2026-07-01')
    expect(r.to).toBe('2026-10-01')
    expect(r.months).toBe(3)
  })

  it('ends at the end of the month, not at today', () => {
    // A trailing part-month bar shrinks as you look at it and invites comparing
    // half a month against whole ones, which is the most common way a spending
    // trend lies.
    const early = resolveRange('6m', '2026-09-01')
    const late = resolveRange('6m', '2026-09-30')
    expect(early).toEqual(late)
  })

  it('crosses the year boundary without a special case', () => {
    const r = resolveRange('6m', '2026-02-14')
    expect(r.from).toBe('2025-09-01')
    expect(r.to).toBe('2026-03-01')
  })

  it('makes "this month" exactly one month', () => {
    const r = resolveRange('1m', '2026-09-18')
    expect(r.from).toBe('2026-09-01')
    expect(r.to).toBe('2026-10-01')
    expect(monthsInRange(r)).toEqual(['2026-09'])
  })

  it('makes year to date start in January', () => {
    const r = resolveRange('ytd', '2026-09-18')
    expect(r.from).toBe('2026-01-01')
    expect(r.months).toBe(9)
    // In January, year to date is one month — not zero, and not last year.
    expect(resolveRange('ytd', '2026-01-09').from).toBe('2026-01-01')
    expect(resolveRange('ytd', '2026-01-09').months).toBe(1)
  })

  it('is a pure function of the day it is given', () => {
    // Reading a clock inside would make the host and a widget disagree either
    // side of midnight, and make every test of this untestable.
    expect(resolveRange('12m', '2026-09-18')).toEqual(resolveRange('12m', '2026-09-18'))
  })

  it('labels every key', () => {
    for (const key of RANGE_KEYS) {
      expect(resolveRange(key, '2026-09-18').label.length).toBeGreaterThan(0)
    }
  })

  it('recognises its own keys and nothing else', () => {
    expect(isRangeKey('12m')).toBe(true)
    expect(isRangeKey('ytd')).toBe(true)
    expect(isRangeKey('99m')).toBe(false)
    expect(isRangeKey('')).toBe(false)
    expect(isRangeKey(DEFAULT_RANGE_KEY)).toBe(true)
  })
})

describe('months in a range', () => {
  it('lists every month, with none missing in the middle', () => {
    const r = resolveRange('3m', '2026-01-15')
    // The list is what fills gaps in a trend chart, so a month with no
    // spending still gets a slot rather than the chart closing over it.
    expect(monthsInRange(r)).toEqual(['2025-11', '2025-12', '2026-01'])
  })

  it('returns exactly as many months as the range claims', () => {
    for (const key of RANGE_KEYS) {
      const r = resolveRange(key, '2026-09-18')
      expect(monthsInRange(r).length).toBe(r.months)
    }
  })

  it('is ordered oldest first', () => {
    const months = monthsInRange(resolveRange('12m', '2026-09-18'))
    expect([...months].sort()).toEqual(months)
  })
})
