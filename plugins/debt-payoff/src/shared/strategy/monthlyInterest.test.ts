import { describe, expect, it } from 'vitest'
import { monthlyInterest } from './monthlyInterest.js'

/** Whole currency units to the engine's integer units (0.0001). */
const units = (whole: number): bigint => BigInt(whole) * 10_000n

describe('monthlyInterest', () => {
  it('is balance × APR ÷ 12, exactly when it divides evenly', () => {
    // 1,000.00 at 12% a year is 1% a month.
    expect(monthlyInterest(units(1000), 120_000n)).toBe(units(10))
    // 5,000.00 at 24% is 2% a month.
    expect(monthlyInterest(units(5000), 240_000n)).toBe(units(100))
  })

  it('is zero at a zero rate and on a zero balance', () => {
    expect(monthlyInterest(units(1000), 0n)).toBe(0n)
    expect(monthlyInterest(0n, 249_900n)).toBe(0n)
  })

  it('rounds half away from zero to a whole unit of 0.0001', () => {
    // One unit at 600% a year is exactly half a unit a month: a tie, which goes up.
    expect(monthlyInterest(1n, 6_000_000n)).toBe(1n)
    // Three units at 600% is 1.5 units: also up, to 2.
    expect(monthlyInterest(3n, 6_000_000n)).toBe(2n)
    // Just under a tie goes down, just over goes up.
    expect(monthlyInterest(1n, 5_999_999n)).toBe(0n)
    expect(monthlyInterest(1n, 6_000_001n)).toBe(1n)
  })

  it('rounds once, on the exact product, rather than rounding the rate first', () => {
    // 333.33 at 19.99%: 333.33 × 0.1999 ÷ 12 = 5.552 7..., not the 5.55 a
    // cent-rounded intermediate would give.
    expect(monthlyInterest(3_333_300n, 199_900n)).toBe(55_527n)
  })

  it('does not lose precision on balances beyond a double', () => {
    // 999,999,999,999,999.9999 at 12%: a double cannot hold this balance.
    const balance = 10n ** 19n - 1n
    expect(monthlyInterest(balance, 120_000n)).toBe(((10n ** 19n - 1n) * 120_000n + 6_000_000n) / 12_000_000n)
  })
})
