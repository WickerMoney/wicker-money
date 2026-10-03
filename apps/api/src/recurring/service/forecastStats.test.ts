import { describe, expect, it } from 'vitest'
import { forecastStats } from './forecastStats.js'

const day = (date: string, balance: string, low = balance) => ({ date, balance, low })

describe('forecastStats', () => {
  const days = [
    day('2026-10-03', '400.0000'),
    // Rent before the paycheck: the day ends at 900 but dips to -100 first.
    day('2026-10-04', '900.0000', '-100.0000'),
    day('2026-10-05', '150.0000'),
  ]

  it('reads lows, not end-of-day balances, for the lowest point and breaches', () => {
    const stats = forecastStats('2026-10-02', '400', '200.0000', true, days)
    expect(stats).toEqual({
      start: '400.0000',
      end: '150.0000',
      lowest: { date: '2026-10-04', balance: '-100.0000' },
      daysBelowZero: 1,
      daysBelowBuffer: 2,
      firstBelowZero: { date: '2026-10-04', balance: '-100.0000' },
      firstBelowBuffer: { date: '2026-10-04', balance: '-100.0000' },
    })
  })

  it('counts today as a point: an account already under its buffer breaches today', () => {
    const stats = forecastStats('2026-10-02', '50', '200.0000', true, [day('2026-10-03', '500.0000')])
    expect(stats.firstBelowBuffer).toEqual({ date: '2026-10-02', balance: '50.0000' })
    expect(stats.lowest).toEqual({ date: '2026-10-02', balance: '50.0000' })
    // Day counts cover projected days only.
    expect(stats.daysBelowBuffer).toBe(0)
  })

  it('reports no buffer breach when there is no buffer', () => {
    expect(forecastStats('2026-10-02', '400', '0.0000', true, days).firstBelowBuffer).toBeNull()
  })

  it('leaves overdraft and buffer out for cards and loans', () => {
    const stats = forecastStats('2026-10-02', '-1200', '0.0000', false, [day('2026-10-03', '-1300.0000')])
    expect(stats).toMatchObject({
      lowest: { date: '2026-10-03', balance: '-1300.0000' },
      daysBelowZero: null, daysBelowBuffer: null, firstBelowZero: null, firstBelowBuffer: null,
    })
  })

  it('keeps the first day the lowest is reached when it repeats', () => {
    const flat = [day('2026-10-03', '100.0000'), day('2026-10-04', '100.0000')]
    expect(forecastStats('2026-10-02', '300', '0', true, flat).lowest.date).toBe('2026-10-03')
  })

  it('ends where it started with no projected days', () => {
    expect(forecastStats('2026-10-02', '12.5', '0', true, [])).toMatchObject({ start: '12.5000', end: '12.5000' })
  })
})
