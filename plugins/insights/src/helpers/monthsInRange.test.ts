import { describe, expect, it } from 'vitest'
import { RANGE_KEYS, monthsInRange as sdkMonthsInRange, resolveRange } from '@wickermoney/plugin-sdk'
import { monthsInRange } from './monthsInRange.js'

describe('monthsInRange', () => {
  // The SDK root is imported here, in a test, and nowhere in the shipped code.
  const days = ['2026-01-01', '2026-01-31', '2026-02-28', '2026-06-15', '2026-12-31', '2028-02-29']

  it('matches the SDK for every range key on days across a year, including a leap day', () => {
    for (const key of RANGE_KEYS) {
      for (const today of days) {
        const range = resolveRange(key, today)
        expect(monthsInRange(range), `${key} on ${today}`).toEqual(sdkMonthsInRange(range))
      }
    }
  })

  it('has one entry per month of the range, oldest first', () => {
    const months = monthsInRange(resolveRange('12m', '2026-10-11'))
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-11')
    expect(months.at(-1)).toBe('2026-10')
  })

  it('is empty when the range ends where it starts', () => {
    expect(monthsInRange({ key: '1m', label: 'x', months: 0, from: '2026-03-01', to: '2026-03-01' })).toEqual([])
  })
})
