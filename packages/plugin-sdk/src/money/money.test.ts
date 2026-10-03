import { describe, expect, it } from 'vitest'
import {
  MONEY_SCALE, MONEY_UNIT, ZERO_MONEY,
  absMoney, addMoney, compareMoney, divideUnits, editableMoney, equalMoney, isNegativeMoney,
  isZeroMoney, moneyToUnits, negateMoney, normalizeMoney, subtractMoney, sumMoney, unitsToMoney,
} from './index.js'

/**
 * The shared matrix every money consumer relies on. Before this module the
 * same rules lived in four copies (budgets, insights, spending-trends and the
 * recurrence module), and they had already drifted; these cases are what the
 * copies are being replaced against.
 */

/** Inputs every function must refuse rather than guess at. */
const INVALID = [
  '', ' ', '-', '.', '.5', '5.', '+5', '--5', '1e3', '1E-2', '0x10', 'NaN', 'Infinity',
  '$10', '1,000.00', '1 000', '12.34.56', 'abc', '١٢', // non-ASCII digits
  '1.23456', '0.00001', '-81.20000', // more than four decimal places: refused, not truncated
]

describe('constants', () => {
  it('agree with each other', () => {
    expect(MONEY_UNIT).toBe(10n ** BigInt(MONEY_SCALE))
    expect(ZERO_MONEY).toBe(unitsToMoney(0n))
  })
})

describe('moneyToUnits', () => {
  it.each([
    ['0', 0n],
    ['1', 10_000n],
    ['12.5', 125_000n],
    ['-81.2', -812_000n],
    ['-81.20', -812_000n],
    ['-81.2000', -812_000n],
    ['0.0001', 1n],
    ['-0.0001', -1n],
    ['007.10', 71_000n],
    ['  7 ', 70_000n],
    ['\t-3.5\n', -35_000n],
  ])('%j → %s', (input, units) => {
    expect(moneyToUnits(input)).toBe(units)
  })

  it('treats negative zero as zero', () => {
    for (const z of ['-0', '-0.0', '-0.0000']) expect(moneyToUnits(z)).toBe(0n)
  })

  it('keeps every digit beyond what a double can hold', () => {
    // 19 significant digits: Number('123456789012345.6789') is 123456789012345.67
    expect(moneyToUnits('123456789012345.6789')).toBe(1_234_567_890_123_456_789n)
    expect(moneyToUnits('-999999999999999.9999')).toBe(-9_999_999_999_999_999_999n)
    // No size limit: totals may exceed a single numeric(19,4) column.
    expect(moneyToUnits('12345678901234567890.1234')).toBe(123_456_789_012_345_678_901_234n)
  })

  it.each(INVALID)('refuses %j', (bad) => {
    expect(() => moneyToUnits(bad)).toThrow(RangeError)
  })

  it('refuses non-strings at runtime', () => {
    for (const bad of [12.5, null, undefined, 10n, {}] as unknown as string[]) {
      expect(() => moneyToUnits(bad)).toThrow(RangeError)
    }
  })

  it('names the value in the error', () => {
    expect(() => moneyToUnits('1.23456')).toThrow('Invalid amount: "1.23456"')
    expect(() => moneyToUnits('x', 'leg amount')).toThrow('Invalid leg amount: "x"')
  })
})

describe('unitsToMoney', () => {
  it.each([
    [0n, '0.0000'],
    [1n, '0.0001'],
    [-1n, '-0.0001'],
    [125_000n, '12.5000'],
    [-812_000n, '-81.2000'],
    [-9_999n, '-0.9999'],
    [1_234_567_890_123_456_789n, '123456789012345.6789'],
  ])('%s → %j', (units, text) => {
    expect(unitsToMoney(units)).toBe(text)
  })

  it('never writes negative zero', () => {
    expect(unitsToMoney(-0n)).toBe('0.0000')
    expect(unitsToMoney(moneyToUnits('-0.0000'))).toBe('0.0000')
  })

  it('refuses a number', () => {
    expect(() => unitsToMoney(5 as unknown as bigint)).toThrow(TypeError)
  })

  it('round-trips every canonical value', () => {
    for (const v of ['0.0000', '-0.0001', '450.0000', '-81.2000', '123456789012345.6789']) {
      expect(unitsToMoney(moneyToUnits(v))).toBe(v)
    }
  })
})

describe('divideUnits (half away from zero)', () => {
  it.each([
    [10n, 4n, 3n], // 2.5 → 3
    [-10n, 4n, -3n], // -2.5 → -3, mirror image
    [10n, -4n, -3n],
    [-10n, -4n, 3n],
    [9n, 4n, 2n], // 2.25 → 2
    [11n, 4n, 3n], // 2.75 → 3
    [-9n, 4n, -2n],
    [1n, 3n, 0n],
    [-1n, 3n, 0n], // never -0n (bigint has none)
    [0n, 7n, 0n],
    [12n, 4n, 3n], // exact
  ])('%s / %s → %s', (n, d, q) => {
    expect(divideUnits(n, d)).toBe(q)
  })

  it('matches the old app regression: $370 biweekly is $801.67 a month', () => {
    // 370 × 26 / 12 = 801.6666… → 801.6667 at four places, 801.67 to the cent
    expect(unitsToMoney(divideUnits(moneyToUnits('370') * 26n, 12n))).toBe('801.6667')
    expect(unitsToMoney(divideUnits(moneyToUnits('-370') * 26n, 12n))).toBe('-801.6667')
  })

  it('refuses zero', () => {
    expect(() => divideUnits(1n, 0n)).toThrow(RangeError)
  })
})

describe('string arithmetic', () => {
  it('is exact where floats are not', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.3000')
    expect(sumMoney(['0.1000', '0.2000', '0.3000'])).toBe('0.6000')
    expect(subtractMoney('0.3', '0.1')).toBe('0.2000')
    expect(addMoney('123456789012345.6789', '0.0001')).toBe('123456789012345.6790')
  })

  it('sums an empty list to zero', () => {
    expect(sumMoney([])).toBe(ZERO_MONEY)
  })

  it('handles signs and zero', () => {
    expect(addMoney('-5', '5')).toBe('0.0000')
    expect(subtractMoney('0', '0.0001')).toBe('-0.0001')
    expect(negateMoney('12.5')).toBe('-12.5000')
    expect(negateMoney('-12.5')).toBe('12.5000')
    expect(negateMoney('0')).toBe('0.0000')
    expect(negateMoney('-0.0000')).toBe('0.0000')
    expect(absMoney('-12.5')).toBe('12.5000')
    expect(absMoney('12.5')).toBe('12.5000')
    expect(absMoney('-0')).toBe('0.0000')
  })

  it('normalizes any spelling to canonical form', () => {
    expect(normalizeMoney('-81.20')).toBe('-81.2000')
    expect(normalizeMoney(' 7 ')).toBe('7.0000')
    expect(normalizeMoney('-0')).toBe('0.0000')
    expect(normalizeMoney('007.5')).toBe('7.5000')
  })

  it.each(INVALID)('every function refuses %j', (bad) => {
    expect(() => addMoney(bad, '1')).toThrow(RangeError)
    expect(() => addMoney('1', bad)).toThrow(RangeError)
    expect(() => subtractMoney(bad, '1')).toThrow(RangeError)
    expect(() => sumMoney(['1', bad])).toThrow(RangeError)
    expect(() => negateMoney(bad)).toThrow(RangeError)
    expect(() => absMoney(bad)).toThrow(RangeError)
    expect(() => normalizeMoney(bad)).toThrow(RangeError)
    expect(() => compareMoney(bad, '1')).toThrow(RangeError)
    expect(() => equalMoney('1', bad)).toThrow(RangeError)
    expect(() => isNegativeMoney(bad)).toThrow(RangeError)
    expect(() => isZeroMoney(bad)).toThrow(RangeError)
    expect(() => editableMoney(bad)).toThrow(RangeError)
  })
})

describe('comparison', () => {
  it('compares by value, not as text', () => {
    expect(equalMoney('-81.2000', '-81.20')).toBe(true)
    expect(equalMoney('-0.0000', '0')).toBe(true)
    expect(equalMoney('0.0001', '0')).toBe(false)
    expect(compareMoney('-81.2000', '-81.20')).toBe(0)
    expect(compareMoney('9', '10')).toBe(-1) // '9' > '10' as text
    expect(compareMoney('10', '9')).toBe(1)
    expect(compareMoney('-10', '-9')).toBe(-1)
    expect(compareMoney('123456789012345.6789', '123456789012345.6788')).toBe(1)
  })

  it('sorts', () => {
    expect(['10', '-0.5', '9.99', '0'].sort(compareMoney)).toEqual(['-0.5', '0', '9.99', '10'])
  })

  it('treats negative zero as zero, not negative', () => {
    expect(isNegativeMoney('-0.0000')).toBe(false)
    expect(isNegativeMoney('-0.0001')).toBe(true)
    expect(isNegativeMoney('0.0000')).toBe(false)
    expect(isZeroMoney('-0.0000')).toBe(true)
    expect(isZeroMoney('0')).toBe(true)
    expect(isZeroMoney('0.00')).toBe(true)
    expect(isZeroMoney('0.0001')).toBe(false)
  })
})

describe('editableMoney', () => {
  it.each([
    ['450.0000', '450.00'],
    ['0.0000', '0.00'],
    ['-0.0000', '0.00'],
    ['1234.5000', '1234.50'],
    ['0.0500', '0.05'],
    ['-12.3400', '-12.34'],
    ['7', '7.00'],
    ['0.1250', '0.1250'], // real sub-cent precision is kept, not rounded away
    ['-0.0050', '-0.0050'],
  ])('%j → %j', (stored, shown) => {
    expect(editableMoney(stored)).toBe(shown)
  })
})
