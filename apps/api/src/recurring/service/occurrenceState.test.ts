import { dailyBalances, nextPayday, scheduledOccurrences } from '@wickermoney/plugin-sdk/recurrence'
import { describe, expect, it } from 'vitest'
import type { OccurrenceLinkRow } from '../repository/OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from '../repository/OccurrenceRecordRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { describeOccurrence, EMPTY_HISTORY, groupHistories, projectedItem, type ItemHistory } from './occurrenceState.js'

const TODAY = '2026-10-03'
const TOMORROW = '2026-10-04'

/** A stored item. */
function item(over: Partial<RecurringItemRow> = {}): RecurringItemRow {
  return {
    id: 'rent', name: 'Rent', kind: 'bill', frequency: 'monthly', series_start_date: '2026-01-01', end_date: null,
    semimonthly_day_1: null, semimonthly_day_2: null, category_id: null, created_at: new Date(0), updated_at: new Date(0),
    legs: [{ account_id: 'chk', amount: '-1500.0000' }],
    ...over,
  }
}

/** A recorded occurrence. */
function record(nominal: string, over: Partial<OccurrenceRecordRow> = {}): OccurrenceRecordRow {
  return { id: `o-${nominal}`, recurring_item_id: 'rent', nominal_date: nominal, skipped: false, expected_date: null, legs: [], ...over }
}

/** A settling transaction. */
function link(nominal: string, accountId = 'chk', amount = '-1500.0000', date = nominal): OccurrenceLinkRow {
  return {
    recurring_item_id: 'rent', nominal_date: nominal, transaction_id: `t-${nominal}-${accountId}`, account_id: accountId,
    amount, transaction_date: date, merchant: 'Landlord',
  }
}

/**
 * A history from rows. Tracking starts at the earliest link unless `since`
 * says otherwise (`true` for "since long ago").
 */
function history(records: OccurrenceRecordRow[], links: OccurrenceLinkRow[] = [], since: string | boolean | null = null): ItemHistory {
  const start = since === true ? '2000-01-01' : since === false ? null : since ?? links.map((l) => l.nominal_date).sort()[0] ?? null
  return groupHistories(records, links, new Map(start === null ? [] : [['rent', start]]))('rent')
}

describe('describeOccurrence', () => {
  const rent = item()

  it('is upcoming after today and assumed on or before it while the item is untracked', () => {
    expect(describeOccurrence(rent, EMPTY_HISTORY, '2026-11-01', TODAY).status).toBe('upcoming')
    expect(describeOccurrence(rent, EMPTY_HISTORY, '2026-10-01', TODAY).status).toBe('assumed')
  })

  it('is due, late or missed by its expected date once the item is tracked', () => {
    const tracked = history([], [], true)
    expect(describeOccurrence(item({ series_start_date: '2026-01-03' }), tracked, '2026-10-03', TODAY).status).toBe('due')
    expect(describeOccurrence(rent, tracked, '2026-10-01', TODAY).status).toBe('late')
    expect(describeOccurrence(rent, tracked, '2026-09-01', TODAY).status).toBe('missed')
  })

  it('counts 7 days back as late and 8 as missed', () => {
    const daily = item({ frequency: 'daily' })
    const tracked = history([], [], true)
    expect(describeOccurrence(daily, tracked, '2026-09-26', TODAY).status).toBe('late')
    expect(describeOccurrence(daily, tracked, '2026-09-25', TODAY).status).toBe('missed')
  })

  it('is cleared when every leg is settled, whatever the date', () => {
    const h = history([record('2026-11-01')], [link('2026-11-01', 'chk', '-1500.0000', '2026-10-02')])
    const state = describeOccurrence(rent, h, '2026-11-01', TODAY)
    expect(state.status).toBe('cleared')
    expect(state.legs[0]?.transaction).toEqual({ id: 't-2026-11-01-chk', date: '2026-10-02', amount: '-1500.0000', merchant: 'Landlord' })
  })

  it('stays upcoming with one side of a split paycheck in', () => {
    const pay = item({ kind: 'income', legs: [{ account_id: 'chk', amount: '1500.0000' }, { account_id: 'sav', amount: '500.0000' }] })
    const h = history([record('2026-10-15')], [link('2026-10-15', 'sav', '500.0000')])
    const state = describeOccurrence(pay, h, '2026-10-15', TODAY)
    expect(state.status).toBe('upcoming')
    expect(state.legs.map((l) => l.transaction !== null)).toEqual([false, true])
  })

  it('is skipped over everything else', () => {
    expect(describeOccurrence(rent, history([record('2026-10-01', { skipped: true })], [], true), '2026-10-01', TODAY).status)
      .toBe('skipped')
  })

  it('judges a moved occurrence by its expected date', () => {
    const h = history([record('2026-10-01', { expected_date: '2026-10-05' })], [], true)
    const state = describeOccurrence(rent, h, '2026-10-01', TODAY)
    expect(state).toMatchObject({ status: 'upcoming', expectedDate: '2026-10-05', moved: true })
  })

  it('uses a changed amount, and flags it', () => {
    const h = history([record('2026-11-01', { legs: [{ account_id: 'chk', amount: '-1525.0000' }] })])
    const state = describeOccurrence(rent, h, '2026-11-01', TODAY)
    expect(state.changed).toBe(true)
    expect(state.legs[0]?.amount).toBe('-1525.0000')
  })

  it('assumes occurrences from before the first match posted, rather than calling them missed', () => {
    const h = history([], [link('2026-09-01')])
    expect(describeOccurrence(item(), h, '2026-08-01', TODAY).status).toBe('assumed')
    expect(describeOccurrence(item(), h, '2026-10-01', TODAY).status).toBe('late')
  })

  it('ignores a stored amount whose sign no longer fits the leg', () => {
    const h = history([record('2026-11-01', { legs: [{ account_id: 'chk', amount: '25.0000' }] })])
    const state = describeOccurrence(rent, h, '2026-11-01', TODAY)
    expect(state).toMatchObject({ changed: false, legs: [{ amount: '-1500.0000' }] })
  })

  it('does not call an equal amount a change', () => {
    const h = history([record('2026-11-01', { legs: [{ account_id: 'chk', amount: '-1500.00' }] })])
    expect(describeOccurrence(rent, h, '2026-11-01', TODAY).changed).toBe(false)
  })
})

describe('projectedItem', () => {
  /** End-of-day balances of `chk` from tomorrow, starting at `start`. */
  function balances(row: RecurringItemRow, h: ItemHistory, days: number, start = '2000.0000'): string[] {
    const projected = projectedItem(row, h, TODAY, TOMORROW)
    const to = new Date(Date.UTC(2026, 9, 4 + days)).toISOString().slice(0, 10)
    return (dailyBalances([projected], { chk: start }, TOMORROW, to)['chk'] ?? []).map((d) => d.balance)
  }

  it('leaves an untracked item exactly as the schedule says', () => {
    const projected = projectedItem(item(), EMPTY_HISTORY, TODAY, TOMORROW)
    expect(projected.overrides).toEqual({})
  })

  it('does not project money that already arrived early (the double count matching fixes)', () => {
    const pay = item({ kind: 'income', series_start_date: '2026-10-05', frequency: 'biweekly', legs: [{ account_id: 'chk', amount: '2000.0000' }] })
    const h = history([record('2026-10-05')], [link('2026-10-05', 'chk', '2000.0000', '2026-10-02')])
    expect(balances(pay, h, 3)).toEqual(['2000.0000', '2000.0000', '2000.0000'])
    expect(nextPayday([projectedItem(pay, h, TODAY, TOMORROW)], TODAY)).toBe('2026-10-19')
  })

  it('carries a late bill of a tracked item to the first projected day', () => {
    const h = history([], [link('2026-09-01')]) // tracked: September was matched
    expect(balances(item(), h, 2)).toEqual(['500.0000', '500.0000'])
    const placed = scheduledOccurrences(projectedItem(item(), h, TODAY, TOMORROW), TOMORROW, '2026-10-06')
    expect(placed).toEqual([{ nominalDate: '2026-10-01', date: TOMORROW, legs: [{ accountId: 'chk', amount: '-1500.0000' }] }])
  })

  it('leaves a late occurrence where it is without a carry date', () => {
    const h = history([], [link('2026-09-01')])
    // Only September (settled) is overridden; October stays on its date.
    expect(projectedItem(item(), h, TODAY, null).overrides).toEqual({ '2026-09-01': { legs: [] } })
  })

  it('drops a missed occurrence instead of carrying it', () => {
    const h = history([], [link('2026-08-01')])
    const projected = projectedItem(item({ series_start_date: '2026-01-20' }), h, TODAY, TOMORROW)
    // 2026-09-20 is 13 days ago: missed, so nothing lands in the window.
    expect(scheduledOccurrences(projected, TOMORROW, '2026-10-19')).toEqual([])
  })

  it('projects only the side of a split paycheck that has not arrived', () => {
    const pay = item({ kind: 'income', series_start_date: '2026-10-05', legs: [{ account_id: 'chk', amount: '1500.0000' }, { account_id: 'sav', amount: '500.0000' }] })
    const h = history([record('2026-10-05')], [link('2026-10-05', 'sav', '500.0000', '2026-10-03')])
    const placed = scheduledOccurrences(projectedItem(pay, h, TODAY, TOMORROW), TOMORROW, '2026-10-06')
    expect(placed[0]?.legs).toEqual([{ accountId: 'chk', amount: '1500.0000' }])
  })

  it('applies skips, moves and changed amounts', () => {
    const h = history([
      record('2026-11-01', { skipped: true }),
      record('2026-12-01', { expected_date: '2026-12-03', legs: [{ account_id: 'chk', amount: '-1600.0000' }] }),
    ])
    const placed = scheduledOccurrences(projectedItem(item(), h, TODAY, TOMORROW), TOMORROW, '2027-01-01')
    expect(placed).toEqual([{ nominalDate: '2026-12-01', date: '2026-12-03', legs: [{ accountId: 'chk', amount: '-1600.0000' }] }])
  })

  it('ignores records on dates the schedule no longer has', () => {
    const h = history([record('2026-10-15', { expected_date: '2026-10-20' })])
    expect(projectedItem(item(), h, TODAY, TOMORROW).overrides).toEqual({})
  })
})
