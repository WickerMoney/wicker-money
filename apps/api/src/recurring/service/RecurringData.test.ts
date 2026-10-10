import { describe, expect, it } from 'vitest'
import { assertCovers, historiesOf, rangeCovering, type RecurringData } from './RecurringData.js'

const data = (over: Partial<RecurringData> = {}): RecurringData => ({
  range: { from: '2026-09-01', to: '2026-10-01' }, items: [], records: [], links: [], trackingStarts: new Map(), ...over,
})

describe('rangeCovering', () => {
  it('is null for no ranges', () => {
    expect(rangeCovering([])).toBeNull()
  })

  it('is the range itself for one', () => {
    expect(rangeCovering([{ from: '2026-09-01', to: '2026-09-10' }])).toEqual({ from: '2026-09-01', to: '2026-09-10' })
  })

  it('spans the earliest start to the latest end, overlapping or apart', () => {
    expect(rangeCovering([
      { from: '2026-09-10', to: '2026-09-20' },
      { from: '2026-08-01', to: '2026-08-05' },
      { from: '2026-09-15', to: '2026-10-02' },
    ])).toEqual({ from: '2026-08-01', to: '2026-10-02' })
  })
})

describe('assertCovers', () => {
  it('accepts a range inside the data, including one equal to it', () => {
    expect(() => assertCovers(data(), { from: '2026-09-05', to: '2026-09-06' }, 'test')).not.toThrow()
    expect(() => assertCovers(data(), { from: '2026-09-01', to: '2026-10-01' }, 'test')).not.toThrow()
  })

  it('refuses a range that starts before or ends after the data, naming the caller', () => {
    expect(() => assertCovers(data(), { from: '2026-08-31', to: '2026-09-02' }, 'describeAt')).toThrow(/describeAt needs 2026-08-31\.\.2026-09-02/)
    expect(() => assertCovers(data(), { from: '2026-09-30', to: '2026-10-02' }, 'test')).toThrow(/covers 2026-09-01\.\.2026-10-01/)
  })
})

describe('historiesOf', () => {
  it('groups the loaded rows by item and carries tracking starts, even for an item with no rows', () => {
    const history = historiesOf(data({
      records: [{ id: 'o1', recurring_item_id: 'rent', nominal_date: '2026-09-01', skipped: true, expected_date: null, legs: [] }],
      trackingStarts: new Map([['gym', '2026-01-05']]),
    }))
    expect(history('rent').records.get('2026-09-01')?.skipped).toBe(true)
    expect(history('rent').tracked).toBe(false)
    expect(history('gym')).toMatchObject({ tracked: true, trackedSince: '2026-01-05' })
    expect(history('gym').records.size).toBe(0)
  })
})
