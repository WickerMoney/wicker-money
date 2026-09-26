import { describe, expect, it } from 'vitest'
import { formatMoney } from './formatMoney.js'

describe('formatMoney', () => {
  it('defaults to US dollars with grouping and two decimals', () => {
    expect(formatMoney('1234.5')).toBe('$1,234.50')
    expect(formatMoney('0')).toBe('$0.00')
  })

  it('shows a negative amount with a minus sign', () => {
    expect(formatMoney('-12.50')).toBe('-$12.50')
    expect(formatMoney('-0.5')).toBe('-$0.50')
  })

  it('keeps every digit of a value a double cannot hold', () => {
    expect(formatMoney('12345678901234567890.12')).toBe('$12,345,678,901,234,567,890.12')
    expect(formatMoney('9007199254740993.99')).toBe('$9,007,199,254,740,993.99')
    expect(formatMoney('-9007199254740993.01')).toBe('-$9,007,199,254,740,993.01')
  })

  it('honours the currency argument', () => {
    expect(formatMoney('1234.5', 'EUR')).toBe('€1,234.50')
    expect(formatMoney('1234.5', 'GBP')).toBe('£1,234.50')
  })

  it('uses the currency’s own number of decimals', () => {
    expect(formatMoney('1234.5', 'JPY')).toBe('¥1,235')
    expect(formatMoney('1234.5678', 'KWD')).toMatch(/^KWD\s1,234\.568$/)
  })

  it('rounds half away from zero on the exact decimal, not on a float', () => {
    expect(formatMoney('1.005')).toBe('$1.01')
    expect(formatMoney('2.675')).toBe('$2.68')
    expect(formatMoney('-1.005')).toBe('-$1.01')
    expect(formatMoney('0.004')).toBe('$0.00')
  })

  it('carries a rounding overflow into the whole part', () => {
    expect(formatMoney('999.999')).toBe('$1,000.00')
    expect(formatMoney('99999999999999999999.999')).toBe('$100,000,000,000,000,000,000.00')
  })

  it('does not show a minus sign for an amount that rounds to zero', () => {
    expect(formatMoney('-0.001')).toBe('$0.00')
  })

  it('accepts an explicit plus sign, no whole part and no fraction part', () => {
    expect(formatMoney('+5')).toBe('$5.00')
    expect(formatMoney('.5')).toBe('$0.50')
    expect(formatMoney('7.')).toBe('$7.00')
  })

  it('falls back to Number for values that are not plain decimals', () => {
    expect(formatMoney('')).toBe('$0.00')
    expect(formatMoney('abc')).toBe('$NaN')
    expect(formatMoney('1e3')).toBe('$1,000.00')
  })

  it('rejects a malformed currency code', () => {
    expect(() => formatMoney('1', 'not-a-code')).toThrow(RangeError)
  })
})
