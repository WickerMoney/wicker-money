import { describe, expect, it } from 'vitest'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { confidentPairs } from './confidentPairs.js'
import { describeOccurrence, EMPTY_HISTORY } from './occurrenceState.js'
import type { OpenLeg } from './OpenLeg.js'
import { pairKey } from './pairKey.js'

const TODAY = '2026-10-03'

function open(id: string, nominal: string, amount = '-100.0000'): OpenLeg {
  const row: RecurringItemRow = {
    id, name: id, kind: 'bill', frequency: 'monthly', series_start_date: '2026-01-01', end_date: null,
    semimonthly_day_1: null, semimonthly_day_2: null, category_id: null, created_at: new Date(0), updated_at: new Date(0),
    legs: [{ account_id: 'chk', amount }],
  }
  return { row, state: describeOccurrence(row, EMPTY_HISTORY, nominal, TODAY), accountId: 'chk', amount }
}

function tx(id: string, amount: string, date: string, over: Partial<CandidateTransactionRow> = {}): CandidateTransactionRow {
  return { id, account_id: 'chk', amount, transaction_date: date, merchant: id, transfer_id: null, recurring_occurrence_id: null, ...over }
}

const rent = open('rent', '2026-10-01')
const power = open('power', '2026-10-01', '-60.0000')

describe('confidentPairs', () => {
  it('pairs a leg with a close transaction, and nothing for none', () => {
    expect(confidentPairs([rent], [], new Set())).toEqual([])
    const pairs = confidentPairs([rent], [tx('t1', '-100.0000', '2026-10-02')], new Set())
    expect(pairs.map((p) => [p.open.row.id, p.candidate.transactionId])).toEqual([['rent', 't1']])
  })

  it('leaves out candidates that are not confident: too far in date or amount', () => {
    const rows = [tx('late', '-100.0000', '2026-10-09'), tx('big', '-200.0000', '2026-10-01'), tx('ok', '-110.0000', '2026-10-01')]
    expect(confidentPairs([rent], rows, new Set()).map((p) => p.candidate.transactionId)).toEqual(['ok'])
  })

  it('leaves out a dismissed pair but still offers the transaction for another occurrence', () => {
    const rows = [tx('t1', '-80.0000', '2026-10-01')]
    const dismissed = new Set([pairKey('t1', 'rent', '2026-10-01')])
    expect(confidentPairs([rent, power], rows, dismissed).map((p) => `${p.open.row.id}<-${p.candidate.transactionId}`)).toEqual([])
    const only = new Set([pairKey('t1', 'power', '2026-10-01')])
    expect(confidentPairs([rent, power], [tx('t1', '-100.0000', '2026-10-01')], only).map((p) => p.open.row.id)).toEqual(['rent'])
  })

  it('leaves out a transaction already settling an occurrence', () => {
    expect(confidentPairs([rent], [tx('t1', '-100.0000', '2026-10-01', { recurring_occurrence_id: 'o1' })], new Set())).toEqual([])
  })

  it('groups pairs by leg in the order given, whatever the order of the transactions', () => {
    const rows = [tx('p', '-60.0000', '2026-10-01'), tx('r', '-100.0000', '2026-10-01')]
    expect(confidentPairs([rent, power], rows, new Set()).map((p) => `${p.open.row.id}<-${p.candidate.transactionId}`))
      .toEqual(['rent<-r', 'power<-p'])
  })
})
