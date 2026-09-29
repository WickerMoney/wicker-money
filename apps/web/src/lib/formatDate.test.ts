import { afterEach, describe, expect, it } from 'vitest'
import { formatDate } from './formatDate.js'

const original = process.env['TZ']
afterEach(() => { process.env['TZ'] = original })

describe('formatDate', () => {
  it('shows a calendar date as that day, even west of UTC', () => {
    // Midnight UTC on Oct 1 is Sep 30 in New York; the day must not slip.
    process.env['TZ'] = 'America/New_York'
    expect(formatDate('2026-10-01')).toBe(new Date(2026, 9, 1).toLocaleDateString())
    expect(formatDate('2026-10-01')).not.toBe(new Date(2026, 8, 30).toLocaleDateString())
  })

  it('formats an instant as given', () => {
    const instant = '2026-10-01T15:00:00Z'
    expect(formatDate(instant)).toBe(new Date(instant).toLocaleDateString())
  })
})
