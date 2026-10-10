import { describe, expect, it } from 'vitest'
import type { OccurrenceLinkRow } from '../repository/OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from '../repository/OccurrenceRecordRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import type { RecurringData } from './RecurringData.js'
import { suggestionWindow } from './suggestionWindow.js'
import { windowOccurrences } from './windowOccurrences.js'

const TODAY = '2026-10-03'
// Window: expected 2026-09-19 up to (not including) 2026-10-09; scan 2026-08-19 up to 2026-11-09.
const window = suggestionWindow(TODAY)

function item(id: string, start: string, legs: RecurringItemRow['legs'] = [{ account_id: 'chk', amount: '-100.0000' }]): RecurringItemRow {
  return {
    id, name: id, kind: 'bill', frequency: 'monthly', series_start_date: start, end_date: null,
    semimonthly_day_1: null, semimonthly_day_2: null, category_id: null, created_at: new Date(0), updated_at: new Date(0), legs,
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
const phone = item('phone', '2026-01-20')

function data(over: Partial<RecurringData> = {}): RecurringData {
  return { range: window.scan, items: [rent, gym, phone], records: [], links: [], trackingStarts: new Map(), ...over }
}

describe('windowOccurrences', () => {
  it('lists the occurrences expected in the window, items in order then by date, each with its unsettled legs', () => {
    const { inWindow, open } = windowOccurrences(data(), window, TODAY)
    expect([...inWindow.keys()]).toEqual(['rent|2026-10-01', 'gym|2026-10-05', 'phone|2026-09-20'])
    expect(open.map((o) => `${o.row.id}|${o.state.nominalDate}|${o.accountId}|${o.amount}`)).toEqual([
      'rent|2026-10-01|chk|-100.0000', 'gym|2026-10-05|chk|-100.0000', 'phone|2026-09-20|chk|-100.0000',
    ])
  })

  it('keeps a settled leg out of the open legs but the occurrence in the window', () => {
    const d = data({ links: [link('rent', '2026-10-01')], trackingStarts: new Map([['rent', '2026-10-01']]) })
    const { inWindow, open } = windowOccurrences(d, window, TODAY)
    expect(inWindow.get('rent|2026-10-01')?.state.status).toBe('cleared')
    expect(open.map((o) => o.row.id)).toEqual(['gym', 'phone'])
  })

  it('leaves out skipped occurrences', () => {
    const { inWindow } = windowOccurrences(data({ records: [record('gym', '2026-10-05', { skipped: true })] }), window, TODAY)
    expect([...inWindow.keys()]).toEqual(['rent|2026-10-01', 'phone|2026-09-20'])
  })

  it('goes by the expected date: a move can bring an occurrence in from outside or push it out', () => {
    const d = data({
      records: [
        record('gym', '2026-09-05', { expected_date: '2026-09-25' }), // nominal before the window, expected inside
        record('rent', '2026-10-01', { expected_date: '2026-10-20' }), // nominal inside, expected after it
      ],
    })
    const { inWindow } = windowOccurrences(d, window, TODAY)
    expect(inWindow.get('gym|2026-09-05')?.state.expectedDate).toBe('2026-09-25')
    expect(inWindow.has('rent|2026-10-01')).toBe(false)
  })

  it('opens one leg per account of a transfer', () => {
    const move = item('move', '2026-01-02', [{ account_id: 'chk', amount: '-50.0000' }, { account_id: 'sav', amount: '50.0000' }])
    const { open } = windowOccurrences(data({ items: [move] }), window, TODAY)
    expect(open.map((o) => `${o.accountId}|${o.amount}`)).toEqual(['chk|-50.0000', 'sav|50.0000'])
  })

  it('gives the same answer from data loaded for a wider span', () => {
    const rows = { records: [record('gym', '2026-06-05', { skipped: true })], links: [link('rent', '2026-07-01')] }
    const narrow = windowOccurrences(data(rows), window, TODAY)
    const wide = windowOccurrences(data({ ...rows, range: { from: '2026-01-01', to: '2027-01-01' } }), window, TODAY)
    expect(wide).toEqual(narrow)
  })

  it('refuses data that does not cover the scan', () => {
    expect(() => windowOccurrences(data({ range: { from: '2026-09-01', to: window.scan.to } }), window, TODAY)).toThrow(/windowOccurrences needs/)
  })
})
