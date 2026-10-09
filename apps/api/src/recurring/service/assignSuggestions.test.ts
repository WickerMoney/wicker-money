import { describe, expect, it } from 'vitest'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { assignSuggestions } from './assignSuggestions.js'
import type { MatchCandidate } from './matchCandidates.js'
import { describeOccurrence, EMPTY_HISTORY } from './occurrenceState.js'
import type { LegPair } from './OpenLeg.js'

const TODAY = '2026-10-03'

/** A stored item; legs default to one on `chk`. */
function item(id: string, legs: RecurringItemRow['legs'] = [{ account_id: 'chk', amount: '-100.0000' }]): RecurringItemRow {
  return {
    id, name: id, kind: 'bill', frequency: 'monthly', series_start_date: '2026-01-01', end_date: null,
    semimonthly_day_1: null, semimonthly_day_2: null, category_id: null, created_at: new Date(0), updated_at: new Date(0), legs,
  }
}

/** A candidate with a given score. */
function candidate(transactionId: string, score: number): MatchCandidate {
  return {
    transactionId, date: '2026-10-01', amount: '-100.0000', merchant: transactionId, dayDifference: 0,
    amountDifference: '0.0000', confident: true, score,
  }
}

/** A pair: `candidate` against the leg of `row` on `accountId` for the occurrence on `nominal`. */
function pair(row: RecurringItemRow, nominal: string, accountId: string, tx: string, score: number): LegPair {
  const state = describeOccurrence(row, EMPTY_HISTORY, nominal, TODAY)
  const leg = state.legs.find((l) => l.accountId === accountId)
  if (leg === undefined) throw new Error(`no leg on ${accountId}`)
  return { open: { row, state, accountId, amount: leg.amount }, candidate: candidate(tx, score) }
}

/** Compact result: `item|nominal|account<-transaction`. */
const summarize = (pairs: readonly LegPair[]) =>
  assignSuggestions(pairs).map((s) => `${s.occurrence.itemId}|${s.occurrence.nominalDate}|${s.accountId}<-${s.candidate.transactionId}`)

const rent = item('rent')
const power = item('power')
const phone = item('phone')

describe('assignSuggestions', () => {
  it('returns nothing for no pairs', () => {
    expect(assignSuggestions([])).toEqual([])
  })

  it('suggests a lone pair, with the occurrence view, account and candidate', () => {
    const p = pair(rent, '2026-10-01', 'chk', 't1', 0.5)
    const [only, ...rest] = assignSuggestions([p])
    expect(rest).toEqual([])
    expect(only?.accountId).toBe('chk')
    expect(only?.candidate).toBe(p.candidate)
    expect(only?.occurrence).toMatchObject({ itemId: 'rent', nominalDate: '2026-10-01', expectedDate: '2026-10-01', name: 'rent' })
  })

  it('orders suggestions best (lowest score) first, whatever the input order', () => {
    const pairs = [
      pair(rent, '2026-10-01', 'chk', 't-rent', 3),
      pair(power, '2026-10-01', 'chk', 't-power', 1),
      pair(phone, '2026-10-01', 'chk', 't-phone', 2),
    ]
    expect(summarize(pairs)).toEqual(['power|2026-10-01|chk<-t-power', 'phone|2026-10-01|chk<-t-phone', 'rent|2026-10-01|chk<-t-rent'])
  })

  it('keeps input order between equal scores', () => {
    const pairs = [
      pair(power, '2026-10-01', 'chk', 'a', 1),
      pair(rent, '2026-10-01', 'chk', 'b', 1),
      pair(phone, '2026-10-01', 'chk', 'c', 1),
    ]
    expect(summarize(pairs)).toEqual(['power|2026-10-01|chk<-a', 'rent|2026-10-01|chk<-b', 'phone|2026-10-01|chk<-c'])
    expect(summarize([...pairs].reverse())).toEqual(['phone|2026-10-01|chk<-c', 'rent|2026-10-01|chk<-b', 'power|2026-10-01|chk<-a'])
  })

  it('does not suggest a transaction twice: the better leg wins, the other leg goes unmatched', () => {
    const pairs = [
      pair(rent, '2026-10-01', 'chk', 'shared', 2),
      pair(power, '2026-10-01', 'chk', 'shared', 1),
    ]
    expect(summarize(pairs)).toEqual(['power|2026-10-01|chk<-shared'])
  })

  it('does not suggest a leg twice: its better candidate wins and the runner-up is dropped', () => {
    const pairs = [
      pair(rent, '2026-10-01', 'chk', 'worse', 2),
      pair(rent, '2026-10-01', 'chk', 'better', 1),
    ]
    expect(summarize(pairs)).toEqual(['rent|2026-10-01|chk<-better'])
  })

  it('lets a loser fall back to its next candidate when the winner takes its first choice', () => {
    const pairs = [
      pair(rent, '2026-10-01', 'chk', 'x', 1),
      pair(power, '2026-10-01', 'chk', 'x', 2),
      pair(power, '2026-10-01', 'chk', 'y', 3),
    ]
    expect(summarize(pairs)).toEqual(['rent|2026-10-01|chk<-x', 'power|2026-10-01|chk<-y'])
  })

  it('does not let a skipped pair use up its transaction or leg', () => {
    // rent loses 'x' to power, so rent's leg is still free for 'z'.
    const pairs = [
      pair(power, '2026-10-01', 'chk', 'x', 1),
      pair(rent, '2026-10-01', 'chk', 'x', 2),
      pair(rent, '2026-10-01', 'chk', 'z', 3),
    ]
    expect(summarize(pairs)).toEqual(['power|2026-10-01|chk<-x', 'rent|2026-10-01|chk<-z'])
  })

  it('treats the same item on different nominal dates as different legs', () => {
    const daily = { ...item('daily'), frequency: 'daily' as const }
    const pairs = [
      pair(daily, '2026-10-01', 'chk', 'a', 1),
      pair(daily, '2026-10-02', 'chk', 'b', 2),
    ]
    expect(summarize(pairs)).toEqual(['daily|2026-10-01|chk<-a', 'daily|2026-10-02|chk<-b'])
  })

  it('treats the two legs of a transfer as different legs, each with its own transaction', () => {
    const move = item('move', [{ account_id: 'chk', amount: '-100.0000' }, { account_id: 'sav', amount: '100.0000' }])
    const pairs = [
      pair(move, '2026-10-01', 'sav', 'in', 2),
      pair(move, '2026-10-01', 'chk', 'out', 1),
    ]
    expect(summarize(pairs)).toEqual(['move|2026-10-01|chk<-out', 'move|2026-10-01|sav<-in'])
  })

  it('still limits a transfer leg to one candidate and one transaction to one leg', () => {
    const move = item('move', [{ account_id: 'chk', amount: '-100.0000' }, { account_id: 'sav', amount: '100.0000' }])
    const pairs = [
      pair(move, '2026-10-01', 'chk', 'both', 1),
      pair(move, '2026-10-01', 'sav', 'both', 2),
      pair(move, '2026-10-01', 'chk', 'other', 3),
    ]
    expect(summarize(pairs)).toEqual(['move|2026-10-01|chk<-both'])
  })

  it('does not modify its input', () => {
    const pairs = [pair(rent, '2026-10-01', 'chk', 'a', 2), pair(power, '2026-10-01', 'chk', 'b', 1)]
    const before = [...pairs]
    assignSuggestions(pairs)
    expect(pairs).toEqual(before)
    expect(pairs[0]).toBe(before[0])
  })

  it('uses the occurrence expected date, not the nominal one, as the view date', () => {
    const p = pair(rent, '2026-10-01', 'chk', 't', 1)
    const moved = { ...p, open: { ...p.open, state: { ...p.open.state, expectedDate: '2026-10-04', moved: true } } }
    const [only] = assignSuggestions([moved])
    expect(only?.occurrence).toMatchObject({ nominalDate: '2026-10-01', expectedDate: '2026-10-04', date: '2026-10-04', moved: true })
  })
})
