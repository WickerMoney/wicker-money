import { describe, expect, it } from 'vitest'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import type { DismissalRow } from '../repository/DismissalRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { buildDismissed } from './buildDismissed.js'
import type { Described } from './Described.js'
import { occurrenceKey } from './occurrenceKey.js'
import { describeOccurrence, EMPTY_HISTORY } from './occurrenceState.js'

const TODAY = '2026-10-03'

/** A stored item. */
function item(id: string, name = id): RecurringItemRow {
  return {
    id, name, kind: 'bill', frequency: 'monthly', series_start_date: '2026-01-01', end_date: null,
    semimonthly_day_1: null, semimonthly_day_2: null, category_id: null, created_at: new Date(0), updated_at: new Date(0),
    legs: [{ account_id: 'chk', amount: '-100.0000' }],
  }
}

/** An in-window occurrence of an item, optionally moved to another expected date. */
function described(row: RecurringItemRow, nominal: string, expected = nominal): [string, Described] {
  const state = { ...describeOccurrence(row, EMPTY_HISTORY, nominal, TODAY), expectedDate: expected }
  return [occurrenceKey(row.id, nominal), { row, state }]
}

/** A ledger transaction. */
function tx(id: string, over: Partial<CandidateTransactionRow> = {}): CandidateTransactionRow {
  return {
    id, account_id: 'chk', amount: '-100.0000', transaction_date: '2026-10-02', merchant: `m-${id}`, transfer_id: null,
    recurring_occurrence_id: null, ...over,
  }
}

/** A dismissal. */
const dismissal = (transactionId: string, itemId: string, nominalDate: string): DismissalRow =>
  ({ transaction_id: transactionId, recurring_item_id: itemId, nominal_date: nominalDate })

const rent = item('rent', 'Rent')
const power = item('power', 'Power')

describe('buildDismissed', () => {
  it('is empty for no dismissals', () => {
    expect(buildDismissed([], new Map([described(rent, '2026-10-01')]), new Map())).toEqual([])
  })

  it('describes the occurrence and the transaction', () => {
    const inWindow = new Map([described(rent, '2026-10-01')])
    const result = buildDismissed([dismissal('t1', 'rent', '2026-10-01')], inWindow, new Map([['t1', tx('t1', { account_id: 'sav' })]]))
    expect(result).toHaveLength(1)
    expect(result[0]?.accountId).toBe('sav')
    expect(result[0]?.occurrence).toMatchObject({ itemId: 'rent', nominalDate: '2026-10-01', name: 'Rent' })
    expect(result[0]?.transaction).toEqual({ id: 't1', date: '2026-10-02', amount: '-100.0000', merchant: 'm-t1' })
  })

  it('leaves out a dismissal whose transaction already settles an occurrence', () => {
    const inWindow = new Map([described(rent, '2026-10-01')])
    const txs = new Map([['t1', tx('t1', { recurring_occurrence_id: 'occ' })], ['t2', tx('t2')]])
    const result = buildDismissed([dismissal('t1', 'rent', '2026-10-01'), dismissal('t2', 'rent', '2026-10-01')], inWindow, txs)
    expect(result.map((d) => d.transaction.id)).toEqual(['t2'])
  })

  it('leaves out a dismissal whose occurrence is not in the window', () => {
    const inWindow = new Map([described(rent, '2026-10-01')])
    const txs = new Map([['t1', tx('t1')]])
    expect(buildDismissed([dismissal('t1', 'rent', '2026-09-01'), dismissal('t1', 'gone', '2026-10-01')], inWindow, txs)).toEqual([])
  })

  it('leaves out a dismissal whose transaction was not found', () => {
    const inWindow = new Map([described(rent, '2026-10-01')])
    expect(buildDismissed([dismissal('deleted', 'rent', '2026-10-01')], inWindow, new Map())).toEqual([])
  })

  it('orders by expected date, then name, then transaction id', () => {
    const inWindow = new Map([
      described(rent, '2026-10-01', '2026-10-05'),
      described(power, '2026-10-01', '2026-10-05'),
      described(item('late', 'Zeta'), '2026-10-02', '2026-10-09'),
      described(item('early', 'Omega'), '2026-10-02', '2026-10-02'),
    ])
    const txs = new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, tx(id)] as const))
    const result = buildDismissed([
      dismissal('d', 'late', '2026-10-02'),
      dismissal('c', 'rent', '2026-10-01'),
      dismissal('b', 'rent', '2026-10-01'),
      dismissal('e', 'early', '2026-10-02'),
      dismissal('a', 'power', '2026-10-01'),
    ], inWindow, txs)
    expect(result.map((d) => `${d.occurrence.name}/${d.transaction.id}`)).toEqual(['Omega/e', 'Power/a', 'Rent/b', 'Rent/c', 'Zeta/d'])
  })

  it('lists the same transaction once per occurrence it was dismissed for', () => {
    const inWindow = new Map([described(rent, '2026-10-01'), described(power, '2026-10-01')])
    const result = buildDismissed(
      [dismissal('t1', 'rent', '2026-10-01'), dismissal('t1', 'power', '2026-10-01')], inWindow, new Map([['t1', tx('t1')]]),
    )
    expect(result.map((d) => d.occurrence.itemId)).toEqual(['power', 'rent'])
  })
})
