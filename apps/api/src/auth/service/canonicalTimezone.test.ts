import { describe, expect, it } from 'vitest'
import { canonicalTimezone } from './canonicalTimezone.js'

describe('canonicalTimezone', () => {
  it.each([
    ['America/New_York', 'America/New_York'],
    ['america/new_york', 'America/New_York'],
    ['US/Eastern', 'America/New_York'],
    ['utc', 'UTC'],
    ['  Europe/London ', 'Europe/London'],
    ['Etc/GMT+5', 'Etc/GMT+5'],
  ])('accepts %j as %j', (input, expected) => {
    expect(canonicalTimezone(input)).toBe(expected)
  })

  it.each(['', '   ', 'Foo/Bar', '+01:00', '-05:00', 'America/New_York; DROP', 'A'.repeat(65)])(
    'refuses %j',
    (input) => {
      expect(canonicalTimezone(input)).toBeUndefined()
    },
  )
})
