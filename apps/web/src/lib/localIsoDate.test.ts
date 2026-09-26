import { describe, expect, it } from 'vitest'
import { localIsoDate } from './localIsoDate.js'

describe('localIsoDate', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // Built from local components, so it names the same local day in any zone.
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05')
    expect(localIsoDate(new Date(2026, 0, 5, 0, 0, 1))).toBe('2026-01-05')
  })

  it('pads month and day', () => {
    expect(localIsoDate(new Date(2026, 2, 4))).toBe('2026-03-04')
  })

  it('defaults to today', () => {
    expect(localIsoDate()).toBe(localIsoDate(new Date()))
  })
})
