import { describe, expect, it } from 'vitest'
import { suggestionWindow } from './suggestionWindow.js'

describe('suggestionWindow', () => {
  it('looks 14 days back and 5 ahead of today, and scans 31 days further either side for moved occurrences', () => {
    expect(suggestionWindow('2026-10-03')).toEqual({ from: '2026-09-19', to: '2026-10-09', scan: { from: '2026-08-19', to: '2026-11-09' } })
  })

  it('crosses a month and year end', () => {
    expect(suggestionWindow('2027-01-02')).toEqual({ from: '2026-12-19', to: '2027-01-08', scan: { from: '2026-11-18', to: '2027-02-08' } })
  })
})
