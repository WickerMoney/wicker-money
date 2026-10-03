import { describe, expect, it } from 'vitest'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import { rankCandidates } from './matchCandidates.js'

/** A ledger row. */
function tx(id: string, date: string, amount: string, over: Partial<CandidateTransactionRow> = {}): CandidateTransactionRow {
  return {
    id, account_id: 'chk', amount, transaction_date: date, merchant: id, transfer_id: null, recurring_occurrence_id: null, ...over,
  }
}

const rent = { accountId: 'chk', amount: '-1500.0000' }

describe('rankCandidates', () => {
  it('keeps only same-account, same-direction, unmatched rows within ten days', () => {
    const rows = [
      tx('ok', '2026-10-02', '-1500.00'),
      tx('other-account', '2026-10-01', '-1500.00', { account_id: 'sav' }),
      tx('refund', '2026-10-01', '1500.00'),
      tx('matched', '2026-10-01', '-1500.00', { recurring_occurrence_id: 'elsewhere' }),
      tx('too-early', '2026-09-20', '-1500.00'),
      tx('edge', '2026-10-11', '-1500.00'),
    ]
    expect(rankCandidates(rent, '2026-10-01', rows).map((c) => c.transactionId)).toEqual(['ok', 'edge'])
  })

  it('keeps a row already on this occurrence', () => {
    const rows = [tx('mine', '2026-10-01', '-1500.00', { recurring_occurrence_id: 'occ' })]
    expect(rankCandidates(rent, '2026-10-01', rows, 'occ')).toHaveLength(1)
  })

  it('prefers the exact amount a couple of days off to a 30% miss on the day', () => {
    const rows = [tx('close-date', '2026-10-01', '-1950.00'), tx('exact', '2026-10-03', '-1500.00')]
    expect(rankCandidates(rent, '2026-10-01', rows).map((c) => c.transactionId)).toEqual(['exact', 'close-date'])
  })

  it('reports signed differences and confidence', () => {
    const [early] = rankCandidates(rent, '2026-10-05', [tx('a', '2026-10-02', '-1600.00')])
    expect(early).toMatchObject({ dayDifference: -3, amountDifference: '-100.0000', confident: true })
    const [far] = rankCandidates(rent, '2026-10-01', [tx('b', '2026-10-08', '-1500.00')])
    expect(far?.confident).toBe(false)
    const [off] = rankCandidates(rent, '2026-10-01', [tx('c', '2026-10-01', '-2000.00')])
    expect(off?.confident).toBe(false)
  })
})
