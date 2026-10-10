import { describe, expect, it } from 'vitest'
import { describeAt } from './describeAt.js'
import { describeRemaining } from './describeRemaining.js'
import { occurrenceKey } from './occurrenceKey.js'
import type { RecurringData } from './RecurringData.js'
import { windowOccurrences } from './windowOccurrences.js'
import { suggestionWindow } from './suggestionWindow.js'

const rent = {
  id: 'rent', name: 'Rent', kind: 'bill', frequency: 'monthly', series_start_date: '2026-01-05', end_date: null,
  semimonthly_day_1: null, semimonthly_day_2: null, category_id: null, created_at: new Date(0), updated_at: new Date(0),
  legs: [{ account_id: 'chk', amount: '-900.0000' }],
} as unknown as RecurringData['items'][number]

const today = '2026-10-10'
const window = suggestionWindow(today)
const data: RecurringData = { range: window.scan, items: [rent], records: [], links: [], trackingStarts: new Map() }

describe('describeRemaining', () => {
  const wanted = [
    { itemId: 'rent', nominalDate: '2026-10-05' }, // in the suggestion window
    { itemId: 'rent', nominalDate: '2026-09-05' }, // before it
    { itemId: 'gone', nominalDate: '2026-10-05' }, // an item that no longer exists
    { itemId: 'rent', nominalDate: '2026-10-06' }, // not a date on the schedule
  ]

  it('gives what describeAt gives', () => {
    const { inWindow } = windowOccurrences(data, window, today)
    const wide: RecurringData = { ...data, range: { from: '2026-08-01', to: window.scan.to } }
    const { inWindow: wideInWindow } = windowOccurrences(wide, window, today)
    expect(inWindow.size).toBe(1)
    expect(describeRemaining(wide, today, wanted, wideInWindow)).toEqual(describeAt(wide, today, wanted))
    expect(describeRemaining(wide, today, wanted, new Map())).toEqual(describeAt(wide, today, wanted))
  })

  it('takes a known occurrence as it is instead of describing it again', () => {
    const { inWindow } = windowOccurrences(data, window, today)
    const known = inWindow.get(occurrenceKey('rent', '2026-10-05'))
    const out = describeRemaining(data, today, [{ itemId: 'rent', nominalDate: '2026-10-05' }], inWindow)
    expect(out.get(occurrenceKey('rent', '2026-10-05'))).toBe(known)
  })

  it('reads nothing when everything wanted is known', () => {
    const { inWindow } = windowOccurrences(data, window, today)
    // Data that covers nothing would make describeAt throw if it were asked about any date.
    const empty: RecurringData = { ...data, range: { from: '2000-01-01', to: '2000-01-02' } }
    expect(describeRemaining(empty, today, [{ itemId: 'rent', nominalDate: '2026-10-05' }], inWindow).size).toBe(1)
  })
})
