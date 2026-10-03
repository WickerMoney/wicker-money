import { describe, expect, it } from 'vitest'
import {
  addMoney as sdkAdd,
  compareMoney as sdkCompare,
  divideUnits as sdkDivide,
  moneyToUnits as sdkToUnits,
  negateMoney as sdkNegate,
  normalizeMoney as sdkNormalize,
  subtractMoney as sdkSubtract,
  sumMoney as sdkSum,
  unitsToMoney as sdkFromUnits,
} from '@wickermoney/plugin-sdk/money'
import { addMoney, isValidMoney, money, negate, parseMoney, toMoney } from './money.js'

describe('money', () => {
  it('adds without binary floating-point error', () => {
    expect(money('0.1').plus(money('0.2')).toFixed(4)).toBe('0.3000')
    expect(money('10.10').plus(money('0.20')).toFixed(4)).toBe('10.3000')
  })

  it('accepts numbers and strings alike', () => {
    expect(money(12.5).equals(money('12.50'))).toBe(true)
  })

  it('throws on a value that is not a decimal', () => {
    expect(() => money('abc')).toThrow()
  })

  it('keeps 15 integer digits exact', () => {
    expect(money('999999999999999.9999').plus('0.0001').toFixed(4)).toBe('1000000000000000.0000')
  })
})

describe('toMoney', () => {
  it('pads to four places', () => {
    expect(toMoney('12.5')).toBe('12.5000')
    expect(toMoney(3)).toBe('3.0000')
    expect(toMoney('-7')).toBe('-7.0000')
  })

  it('rounds half away from zero at the fifth place', () => {
    expect(toMoney('1.00005')).toBe('1.0001')
    expect(toMoney('1.00004')).toBe('1.0000')
    expect(toMoney('-1.00005')).toBe('-1.0001')
    expect(toMoney('-1.00004')).toBe('-1.0000')
  })

  it('never produces a negative zero', () => {
    expect(toMoney(-0.00001)).toBe('0.0000')
    expect(toMoney('-0.00004')).toBe('0.0000')
    expect(toMoney('-0')).toBe('0.0000')
    expect(toMoney('-0.0000')).toBe('0.0000')
    expect(toMoney(-0)).toBe('0.0000')
    // The smallest representable negative amount keeps its sign.
    expect(toMoney('-0.0001')).toBe('-0.0001')
    expect(toMoney('-0.00005')).toBe('-0.0001')
  })

  it('accepts a Decimal', () => {
    expect(toMoney(money('2.5').times(2))).toBe('5.0000')
  })
})

describe('addMoney', () => {
  it('sums exactly', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.3000')
    expect(addMoney('1.0001', 2, '-3.0001')).toBe('0.0000')
  })

  it('sums an empty list to zero', () => {
    expect(addMoney()).toBe('0.0000')
  })

  it('does not return a negative zero', () => {
    expect(addMoney('-0.00001')).toBe('0.0000')
  })
})

describe('negate', () => {
  it('flips the sign at the storage scale', () => {
    expect(negate('12.5')).toBe('-12.5000')
    expect(negate('-12.5')).toBe('12.5000')
  })

  it('negating zero gives zero, not -0.0000', () => {
    expect(negate('0')).toBe('0.0000')
    expect(negate('0.0000')).toBe('0.0000')
    expect(negate('-0.0000')).toBe('0.0000')
    expect(negate(0)).toBe('0.0000')
  })
})

describe('isValidMoney', () => {
  it.each(['0', '1', '-1', '12.3', '12.3456', '-0.0001', '0.5', '999999999999999', '-999999999999999.9999'])(
    'accepts %s',
    (v) => {
      expect(isValidMoney(v)).toBe(true)
    },
  )

  it.each([
    '', ' ', '1.', '.5', '+1', '--1', '1,000', '1e3', '1E3', '0x10', 'NaN', 'Infinity',
    '1.23456', ' 1', '1 ', '1\n', '1000000000000000', '1.2.3', '-', '- 1', '１２',
  ])('rejects %j', (v) => {
    expect(isValidMoney(v)).toBe(false)
  })
})

describe('parseMoney', () => {
  it('normalises valid strings', () => {
    expect(parseMoney('12.5')).toBe('12.5000')
    expect(parseMoney('-0.0001')).toBe('-0.0001')
    expect(parseMoney('-0')).toBe('0.0000')
  })

  it('accepts finite numbers that fit four places', () => {
    expect(parseMoney(12)).toBe('12.0000')
    expect(parseMoney(0.1)).toBe('0.1000')
    expect(parseMoney(-3.1415)).toBe('-3.1415')
    expect(parseMoney(-0)).toBe('0.0000')
  })

  it('refuses a number with more than four decimal places instead of rounding it', () => {
    // The doc comment promises anything that could lose precision is rejected.
    expect(() => parseMoney(1.23456)).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(-0.00001)).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(1e-7)).toThrow(/at most 4 decimal places/)
  })

  it('refuses a number that has too many integer digits', () => {
    expect(() => parseMoney(1e15)).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(1e21)).toThrow(/at most 4 decimal places/)
    expect(parseMoney(999999999999999)).toBe('999999999999999.0000')
  })

  it('rejects non-finite numbers', () => {
    expect(() => parseMoney(NaN)).toThrow('Amount must be finite.')
    expect(() => parseMoney(Infinity)).toThrow('Amount must be finite.')
    expect(() => parseMoney(-Infinity)).toThrow('Amount must be finite.')
  })

  it('rejects malformed strings and non-string, non-number values', () => {
    expect(() => parseMoney('1.23456')).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney('1e3')).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(' 1')).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney('')).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(null)).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(undefined)).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney({})).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(10n)).toThrow(/at most 4 decimal places/)
    expect(() => parseMoney(true)).toThrow(/at most 4 decimal places/)
  })
})

/** Deterministic PRNG (mulberry32) so a failure is reproducible from the seed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random valid amount string: 0-15 integer digits, 0-4 decimals, optional sign, sometimes unpadded. */
function randomAmount(rand: () => number): string {
  const digit = (): string => String(Math.floor(rand() * 10))
  const intLen = Math.floor(rand() * 16)
  const int = intLen === 0 ? '0' : Array.from({ length: intLen }, digit).join('').replace(/^0+(?=\d)/, '')
  const fracLen = Math.floor(rand() * 5)
  const frac = Array.from({ length: fracLen }, digit).join('')
  // Edge values are over-represented: zeros, one unit, and the ceiling.
  const roll = rand()
  const body = roll < 0.03 ? '0' : roll < 0.06 ? '0.0001' : roll < 0.08 ? '999999999999999.9999' : frac === '' ? int : `${int}.${frac}`
  return rand() < 0.5 && body !== '0' ? `-${body}` : body
}

describe('agreement with the plugin SDK money module (2,000 seeded cases)', () => {
  const rand = seeded(20260919)
  const cases = Array.from({ length: 2000 }, () => ({ a: randomAmount(rand), b: randomAmount(rand) }))

  it('generates only valid amounts', () => {
    expect(cases.every(({ a, b }) => isValidMoney(a) && isValidMoney(b))).toBe(true)
  })

  it('formats identically', () => {
    for (const { a } of cases) {
      expect(toMoney(a), a).toBe(sdkNormalize(a))
      expect(parseMoney(a), a).toBe(sdkNormalize(a))
    }
  })

  it('adds identically', () => {
    for (const { a, b } of cases) {
      expect(toMoney(money(a).plus(b)), `${a} + ${b}`).toBe(sdkAdd(a, b))
      expect(addMoney(a, b), `${a} + ${b}`).toBe(sdkAdd(a, b))
    }
  })

  it('subtracts identically', () => {
    for (const { a, b } of cases) {
      expect(toMoney(money(a).minus(b)), `${a} - ${b}`).toBe(sdkSubtract(a, b))
    }
  })

  it('negates identically, including zero', () => {
    for (const { a } of cases) {
      expect(negate(a), a).toBe(sdkNegate(a))
    }
  })

  it('compares identically', () => {
    for (const { a, b } of cases) {
      expect(money(a).comparedTo(b), `${a} <=> ${b}`).toBe(sdkCompare(a, b))
    }
  })

  it('sums a list identically', () => {
    for (let i = 0; i + 5 <= cases.length; i += 5) {
      const values = cases.slice(i, i + 5).map((c) => c.a)
      expect(addMoney(...values), values.join(',')).toBe(sdkSum(values))
    }
  })

  it('divides identically: both round half away from zero', () => {
    // The SDK's only rounding is divideUnits; decimal.js is set to ROUND_HALF_UP,
    // which also rounds ties away from zero. Small divisors make ties common.
    const divisors = [2n, 3n, 4n, 7n, 12n, -2n, -8n]
    for (const [i, { a }] of cases.entries()) {
      const d = divisors[i % divisors.length] ?? 2n
      expect(sdkFromUnits(sdkDivide(sdkToUnits(a), d)), `${a} / ${d}`)
        .toBe(toMoney(money(a).div(Number(d))))
    }
  })

  it('refuses the same malformed input', () => {
    // The SDK trims surrounding whitespace and has no 15-digit ceiling (it is
    // also used for totals), so those cases differ by design and are left out.
    for (const v of ['', '1.', '.5', '+1', '--1', '1,000', '1e3', '0x10', 'NaN', 'Infinity', '1.23456', '1.2.3', '-', '- 1', '１２']) {
      expect(isValidMoney(v), v).toBe(false)
      expect(() => sdkToUnits(v), v).toThrow(RangeError)
    }
  })

  it('round-trips: (a + b) - b equals a at the storage scale', () => {
    for (const { a, b } of cases) {
      expect(toMoney(money(a).plus(b).minus(b))).toBe(toMoney(a))
    }
  })
})
