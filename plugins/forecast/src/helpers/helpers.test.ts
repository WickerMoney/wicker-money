import { describe, expect, it } from 'vitest'
import { axisDates } from './axisDates.js'
import { axisMoney } from './axisMoney.js'
import { breachMessages } from './breachMessages.js'
import { counterpart } from './counterpart.js'
import { niceTicks } from './niceTicks.js'
import { stepPath } from './stepPath.js'
import type { ForecastAccount, ForecastStats } from '../models/index.js'

const span = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))

describe('niceTicks', () => {
  it('covers the range in round steps', () => {
    expect(niceTicks(-120, 2350)).toEqual([-500, 0, 500, 1000, 1500, 2000, 2500])
  })
  it('opens up a flat line instead of dividing by zero', () => {
    const ticks = niceTicks(500, 500)
    expect(ticks[0]).toBeLessThan(500)
    expect(ticks.at(-1)).toBeGreaterThan(500)
  })
})

describe('axisDates', () => {
  it('labels a short chart weekly', () => {
    expect(axisDates(span('2026-10-03', 30))).toEqual([0, 7, 14, 21, 28])
  })
  it('labels a long chart on month starts, plus the opening day when there is room', () => {
    const dates = span('2026-10-03', 90)
    expect(axisDates(dates).map((i) => dates[i])).toEqual(['2026-10-03', '2026-11-01', '2026-12-01'])
  })
  it('thins labels on a narrow chart', () => {
    expect(axisDates(span('2026-10-03', 30), 120)).toEqual([0, 14, 28])
  })
  it('drops the opening label when a month starts right after it', () => {
    const dates = span('2026-10-28', 90)
    expect(axisDates(dates).map((i) => dates[i])).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
  })
})

describe('stepPath', () => {
  it('steps at day boundaries and draws a same-day dip', () => {
    const d = stepPath(
      [{ low: 100, balance: 100 }, { low: 100, balance: 100 }, { low: -50, balance: 400 }],
      (i) => i * 10,
      (v) => v,
    )
    expect(d).toBe('M0,100H10H20V-50V400H30')
  })
  it('is empty with nothing to draw', () => {
    expect(stepPath([], (i) => i, (v) => v)).toBe('')
  })
})

describe('counterpart', () => {
  const names = (id: string) => ({ c: 'Checking', s: 'Savings', y: 'Yearly' })[id] ?? '?'
  const legs = [{ accountId: 'c', amount: '-300' }, { accountId: 's', amount: '300' }]
  it('names where a transfer goes or comes from', () => {
    expect(counterpart({ itemId: 'i', date: 'd', name: 'n', kind: 'transfer', amount: '-300', legs }, 'c', names)).toBe('to Savings')
    expect(counterpart({ itemId: 'i', date: 'd', name: 'n', kind: 'transfer', amount: '300', legs }, 's', names)).toBe('from Checking')
  })
  it('names the other halves of a split paycheck, and nothing for a bill', () => {
    const split = [{ accountId: 'c', amount: '1800' }, { accountId: 'y', amount: '400' }]
    expect(counterpart({ itemId: 'i', date: 'd', name: 'Pay', kind: 'income', amount: '1800', legs: split }, 'c', names)).toBe('also to Yearly')
    expect(counterpart({ itemId: 'i', date: 'd', name: 'Rent', kind: 'bill', amount: '-1', legs: [{ accountId: 'c', amount: '-1' }] }, 'c', names)).toBe('')
  })
})

describe('breachMessages', () => {
  const account: ForecastAccount = { accountId: 'c', name: 'Monthly', accountType: 'checking', balance: '400', buffer: '200', cash: true }
  const clear: ForecastStats = {
    start: '400', end: '500', lowest: { date: '2026-10-02', balance: '400' },
    daysBelowZero: 0, daysBelowBuffer: 0, firstBelowZero: null, firstBelowBuffer: null,
  }
  const say = (stats: ForecastStats, a = account) => breachMessages(a, stats, '2026-10-02', (v) => `$${v}`, (v) => v)

  it('says nothing when the account stays clear', () => {
    expect(say(clear)).toEqual([])
  })
  it('names the buffer breach first when it comes before going below zero, then the lowest point', () => {
    expect(say({
      ...clear,
      firstBelowBuffer: { date: '2026-10-05', balance: '150' },
      firstBelowZero: { date: '2026-10-09', balance: '-20' },
      lowest: { date: '2026-10-10', balance: '-90' },
    })).toEqual([
      'Monthly drops below its $200 buffer on 2026-10-05, to $150.',
      'Monthly goes below zero on 2026-10-09, to $-20.',
      'Its lowest point is $-90 on 2026-10-10.',
    ])
  })
  it('only says overdrawn when both happen the same day', () => {
    expect(say({
      ...clear,
      firstBelowBuffer: { date: '2026-10-05', balance: '-20' },
      firstBelowZero: { date: '2026-10-05', balance: '-20' },
      lowest: { date: '2026-10-05', balance: '-20' },
    })).toEqual(['Monthly goes below zero on 2026-10-05, to $-20.'])
  })
  it('says "already" for a breach today', () => {
    expect(say({ ...clear, firstBelowBuffer: { date: '2026-10-02', balance: '50' }, lowest: { date: '2026-10-02', balance: '50' } }))
      .toEqual(['Monthly is already below its $200 buffer, at $50.'])
  })
  it('has no banner for a card', () => {
    expect(say({ ...clear, firstBelowZero: { date: '2026-10-03', balance: '-5' } }, { ...account, cash: false })).toEqual([])
  })
})

describe('axisMoney', () => {
  it('drops zero cents in either decimal style and keeps real ones', () => {
    expect(axisMoney(15000, () => '$15,000.00')).toBe('$15,000')
    expect(axisMoney(15000, () => '15.000,00 €')).toBe('15.000 €')
    expect(axisMoney(-500, () => '-$500.00')).toBe('-$500')
    expect(axisMoney(2.5, () => '$2.50')).toBe('$2.50')
  })
})
