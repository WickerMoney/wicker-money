import { describe, expect, it } from 'vitest'
import { timezoneOptions } from './timezoneOptions.js'

describe('timezoneOptions', () => {
  it('puts UTC first, once, and sorts the rest', () => {
    const zones = timezoneOptions()
    expect(zones[0]).toBe('UTC')
    expect(zones.filter((z) => z === 'UTC')).toHaveLength(1)
    expect(zones).toContain('America/New_York')
    const rest = zones.slice(1)
    expect([...rest].sort((a, b) => a.localeCompare(b))).toEqual(rest)
  })

  it('keeps the current zone even when the browser does not list it', () => {
    expect(timezoneOptions('US/Eastern')).toContain('US/Eastern')
  })
})
