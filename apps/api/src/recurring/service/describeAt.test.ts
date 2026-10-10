import { describe, expect, it } from 'vitest'
import type { OccurrenceLinkRow } from '../repository/OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from '../repository/OccurrenceRecordRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { describeAt, wantedRange } from './describeAt.js'
import { describeOccurrence, groupHistories } from './occurrenceState.js'
import type { RecurringData } from './RecurringData.js'

const TODAY = '2026-10-03'

function item(id: string, start: string, amount = '-100.0000'): RecurringItemRow {
  return {
    id, name: id, kind: 'bill', frequency: 'monthly', series_start_date: start, end_date: null,
    semimonthly_day_1: null, semimonthly_day_2: null, category_id: null, created_at: new Date(0), updated_at: new Date(0),
    legs: [{ account_id: 'chk', amount }],
  }
}

function record(itemId: string, nominal: string, over: Partial<OccurrenceRecordRow> = {}): OccurrenceRecordRow {
  return { id: `o-${itemId}-${nominal}`, recurring_item_id: itemId, nominal_date: nominal, skipped: false, expected_date: null, legs: [], ...over }
}

function link(itemId: string, nominal: string): OccurrenceLinkRow {
  return {
    recurring_item_id: itemId, nominal_date: nominal, transaction_id: `t-${itemId}-${nominal}`, account_id: 'chk',
    amount: '-100.0000', transaction_date: nominal, merchant: 'Shop',
  }
}

const rent = item('rent', '2026-01-01')
const gym = item('gym', '2026-01-05')

function data(over: Partial<RecurringData> = {}): RecurringData {
  return {
    range: { from: '2026-09-01', to: '2026-10-10' }, items: [rent, gym], records: [], links: [],
    trackingStarts: new Map(), ...over,
  }
}

describe('wantedRange', () => {
  it('runs from the earliest nominal date to the day after the latest, whatever the order', () => {
    expect(wantedRange([
      { itemId: 'a', nominalDate: '2026-09-20' }, { itemId: 'b', nominalDate: '2026-09-01' }, { itemId: 'c', nominalDate: '2026-09-30' },
    ])).toEqual({ from: '2026-09-01', to: '2026-10-01' })
  })
})

describe('describeAt', () => {
  it('describes nothing without reading the data, so an empty request needs no load', () => {
    const elsewhere = data({ range: { from: '1999-01-01', to: '1999-01-02' } })
    expect(describeAt(elsewhere, TODAY, []).size).toBe(0)
  })

  it('describes each wanted occurrence as describeOccurrence would, by item and nominal date', () => {
    const d = data({
      records: [record('rent', '2026-10-01', { skipped: true })],
      links: [link('gym', '2026-09-05')],
      trackingStarts: new Map([['gym', '2026-09-05']]),
    })
    const out = describeAt(d, TODAY, [
      { itemId: 'rent', nominalDate: '2026-10-01' }, { itemId: 'gym', nominalDate: '2026-09-05' }, { itemId: 'gym', nominalDate: '2026-10-05' },
    ])
    expect([...out.keys()]).toEqual(['rent|2026-10-01', 'gym|2026-09-05', 'gym|2026-10-05'])
    expect(out.get('rent|2026-10-01')?.state.status).toBe('skipped')
    expect(out.get('gym|2026-09-05')?.state.status).toBe('cleared')
    expect(out.get('gym|2026-09-05')?.row).toBe(gym)
    expect(out.get('gym|2026-10-05')?.state.status).toBe('upcoming')

    const history = groupHistories(d.records, d.links, d.trackingStarts)
    expect(out.get('gym|2026-09-05')?.state).toEqual(describeOccurrence(gym, history('gym'), '2026-09-05', TODAY))
  })

  it('leaves out an item that is gone and a date the schedule does not have', () => {
    const out = describeAt(data(), TODAY, [
      { itemId: 'gone', nominalDate: '2026-10-01' }, { itemId: 'rent', nominalDate: '2026-10-02' }, { itemId: 'rent', nominalDate: '2026-10-01' },
    ])
    expect([...out.keys()]).toEqual(['rent|2026-10-01'])
  })

  it('refuses data that does not reach the wanted dates, rather than reading them as "nothing recorded"', () => {
    expect(() => describeAt(data(), TODAY, [{ itemId: 'rent', nominalDate: '2026-08-01' }])).toThrow(/describeAt needs/)
    expect(() => describeAt(data(), TODAY, [{ itemId: 'rent', nominalDate: '2026-10-10' }])).toThrow(/describeAt needs/)
  })

  it('gives the same answer from data loaded for a wider span, which is what lets one load serve two readers', () => {
    const rows = {
      records: [record('rent', '2026-10-01', { expected_date: '2026-10-04' }), record('gym', '2026-06-05', { skipped: true })],
      links: [link('rent', '2026-09-01'), link('gym', '2026-07-05')],
      trackingStarts: new Map([['rent', '2026-03-01'], ['gym', '2026-07-05']]),
    }
    const wanted = [{ itemId: 'rent', nominalDate: '2026-09-01' }, { itemId: 'rent', nominalDate: '2026-10-01' }]
    const exact = describeAt(data({ ...rows, range: wantedRange(wanted) }), TODAY, wanted)
    const wide = describeAt(data({ ...rows, range: { from: '2026-05-01', to: '2026-12-01' } }), TODAY, wanted)
    expect(wide).toEqual(exact)
    expect(wide.get('rent|2026-10-01')?.state).toMatchObject({ expectedDate: '2026-10-04', moved: true })
  })
})
