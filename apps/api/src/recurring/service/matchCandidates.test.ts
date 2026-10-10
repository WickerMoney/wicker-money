import { describe, expect, it } from 'vitest'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import { money } from '../../money.js'
import { MATCH_WINDOW_DAYS, rankCandidates, rankParsedCandidates, SUGGEST_AMOUNT_TOLERANCE, SUGGEST_DAYS, type MatchCandidate } from './matchCandidates.js'
import { parseCandidates } from './parseCandidates.js'

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

/** The ranking as it was before amounts were parsed once: a `Decimal` for every row, checked in the original order. */
function rankReference(
  leg: { accountId: string; amount: string },
  expectedDate: string,
  rows: readonly CandidateTransactionRow[],
  occurrenceId: string | null = null,
): MatchCandidate[] {
  const expected = money(leg.amount)
  const negative = expected.isNegative()
  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
  const found: MatchCandidate[] = []
  for (const row of rows) {
    if (row.account_id !== leg.accountId) continue
    if (row.recurring_occurrence_id !== null && row.recurring_occurrence_id !== occurrenceId) continue
    const actual = money(row.amount)
    if (actual.isZero() || actual.isNegative() !== negative) continue
    const dayDifference = days(expectedDate, row.transaction_date)
    if (Math.abs(dayDifference) > MATCH_WINDOW_DAYS) continue
    const difference = actual.minus(expected)
    const relative = difference.abs().dividedBy(expected.abs())
    found.push({
      transactionId: row.id, date: row.transaction_date, amount: row.amount, merchant: row.merchant, dayDifference,
      amountDifference: difference.toFixed(4),
      confident: Math.abs(dayDifference) <= SUGGEST_DAYS && relative.lessThanOrEqualTo(SUGGEST_AMOUNT_TOLERANCE),
      score: Math.abs(dayDifference) + relative.times(10).toNumber(),
    })
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return found.sort((a, b) => a.score - b.score || cmp(a.date, b.date) || cmp(a.transactionId, b.transactionId))
}

describe('rankCandidates against the per-row Decimal ranking it replaced', () => {
  /** A small deterministic generator, so a failure is reproducible. */
  function lcg(seed: number): () => number {
    let state = seed
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
      return state / 4_294_967_296
    }
  }

  const accounts = ['chk', 'sav', 'card']
  const rows = (() => {
    const next = lcg(7)
    return Array.from({ length: 400 }, (_, i): CandidateTransactionRow => {
      const cents = Math.floor(next() * 300_000) - 150_000 // -1500.00 .. 1500.00, including zero and both signs
      const day = 1 + Math.floor(next() * 40) // spans well past the ten-day window
      return {
        id: `t${String(i).padStart(3, '0')}`,
        account_id: accounts[Math.floor(next() * accounts.length)] as string,
        amount: (cents / 100).toFixed(4),
        transaction_date: `2026-${day > 31 ? '11' : '10'}-${String(day > 31 ? day - 31 : day).padStart(2, '0')}`,
        merchant: `m${i}`,
        transfer_id: null,
        recurring_occurrence_id: next() < 0.15 ? (next() < 0.5 ? 'occ' : 'other') : null,
      }
    })
  })()
  rows.push(tx('zero', '2026-10-15', '0.0000'))

  const legs = [
    { accountId: 'chk', amount: '-1500.0000' }, { accountId: 'sav', amount: '250.5000' },
    { accountId: 'card', amount: '-0.0100' }, { accountId: 'nowhere', amount: '-5.0000' },
  ]

  it('gives the same candidates, in the same order, for every leg', () => {
    for (const leg of legs) {
      for (const expectedDate of ['2026-10-01', '2026-10-15', '2026-10-31', '2026-11-04']) {
        for (const occurrenceId of [null, 'occ']) {
          const expected = rankReference(leg, expectedDate, rows, occurrenceId)
          expect(rankCandidates(leg, expectedDate, rows, occurrenceId)).toEqual(expected)
        }
      }
    }
    expect(rankReference(legs[0] as (typeof legs)[number], '2026-10-15', rows).length).toBeGreaterThan(5)
  })

  it('gives the same candidates when the rows are parsed once and shared by several legs', () => {
    const parsed = parseCandidates(rows)
    for (const leg of legs) {
      expect(rankParsedCandidates(leg, '2026-10-15', parsed)).toEqual(rankReference(leg, '2026-10-15', rows))
    }
  })

  it('parses an amount only for a row that passes the account, link and date checks, and then only once', () => {
    const parsed = parseCandidates([
      tx('ok', '2026-10-02', '-1500.00'),
      tx('other-account', '2026-10-01', '-1500.00', { account_id: 'sav' }),
      tx('matched', '2026-10-01', '-1500.00', { recurring_occurrence_id: 'elsewhere' }),
      tx('too-early', '2026-09-20', '-1500.00'),
    ])
    const calls = parsed.map((p) => {
      let n = 0
      const amount = p.amount
      return Object.assign(p, { amount: () => { n++; return amount() }, calls: () => n })
    })
    rankParsedCandidates(rent, '2026-10-01', calls)
    rankParsedCandidates(rent, '2026-10-01', calls)
    expect(calls.map((c) => c.calls())).toEqual([2, 0, 0, 0])
  })
})
