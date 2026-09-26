import { describe, expect, it } from 'vitest'
import type { SummaryRow } from '../models/index.js'
import { absAmount } from './absAmount.js'
import { formatAmount } from './formatAmount.js'
import { isNegativeAmount } from './isNegativeAmount.js'
import { parseAmount } from './parseAmount.js'
import { subtractAmounts } from './subtractAmounts.js'
import { sumAmounts } from './sumAmounts.js'
import { topCategories } from './topCategories.js'
import { totalsByMonth } from './totalsByMonth.js'

const row = (over: Partial<SummaryRow>): SummaryRow => ({
  month: '2026-07', categoryId: 'a', categoryName: 'Groceries', kind: 'expense', total: '0', ...over,
})

describe('amount arithmetic', () => {
  it('parses and formats without going through a float', () => {
    expect(parseAmount('12.5')).toBe(125_000n)
    expect(parseAmount('-0.0001')).toBe(-1n)
    expect(parseAmount('  7 ')).toBe(70_000n)
    expect(formatAmount(-1n)).toBe('-0.0001')
    expect(formatAmount(0n)).toBe('0.0000')
    expect(formatAmount(parseAmount('123456789012345.67'))).toBe('123456789012345.6700')
  })

  it('refuses text that is not an amount', () => {
    for (const bad of ['', 'abc', '1,000.00', '1e3', '--1', '.5', '1.']) {
      expect(() => parseAmount(bad), bad).toThrow(RangeError)
    }
  })

  it('truncates beyond four places rather than rounding', () => {
    expect(formatAmount(parseAmount('1.99999'))).toBe('1.9999')
  })

  it('sums, subtracts, negates and compares exactly', () => {
    expect(sumAmounts(['0.1', '0.2'])).toBe('0.3000')
    expect(sumAmounts([])).toBe('0.0000')
    expect(subtractAmounts('0.3', '0.1')).toBe('0.2000')
    expect(isNegativeAmount('-0.0001')).toBe(true)
    expect(isNegativeAmount('0.0000')).toBe(false)
    expect(absAmount('-12.5')).toBe('12.5000')
  })
})

describe('totalsByMonth is exact', () => {
  it('adds 0.1 and 0.2 to 0.3, not 0.30000000000000004', () => {
    const totals = totalsByMonth([row({ total: '0.1' }), row({ categoryId: 'b', total: '0.2' })])

    expect(totals).toEqual([{ month: '2026-07', income: '0.0000', expense: '0.3000', net: '-0.3000' }])
  })

  it('keeps every digit of fifteen-digit amounts', () => {
    const totals = totalsByMonth([
      row({ total: '123456789012345.67' }),
      row({ categoryId: 'b', total: '0.01' }),
      row({ kind: 'income', categoryId: 's', categoryName: 'Salary', total: '999999999999999.99' }),
    ])

    expect(totals[0]).toEqual({
      month: '2026-07',
      income: '999999999999999.9900',
      expense: '123456789012345.6800',
      net: '876543210987654.3100',
    })
    // The float route would have lost the last digits of the same sum.
    expect(String(123456789012345.67 + 0.01)).not.toBe('123456789012345.68')
  })

  it('nets a month of refunds to a negative expense', () => {
    const totals = totalsByMonth([row({ total: '-0.3' }), row({ categoryId: 'b', total: '0.1' })])

    expect(totals[0]).toMatchObject({ expense: '-0.2000', net: '0.2000' })
  })

  it('does not let thousands of small rows drift', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row({ categoryId: String(i), total: '0.1' }))

    expect(totalsByMonth(rows)[0]?.expense).toBe('100.0000')
  })

  it('rejects a malformed total instead of charting nonsense', () => {
    expect(() => totalsByMonth([row({ total: 'NaN' })])).toThrow(RangeError)
  })
})

describe('topCategories is exact', () => {
  it('adds 0.1 and 0.2 within a category', () => {
    const result = topCategories([
      row({ total: '0.1' }),
      row({ month: '2026-08', total: '0.2' }),
    ])

    expect(result).toEqual([{ name: 'Groceries', total: '0.3000' }])
  })

  it('ranks and folds fifteen-digit amounts without losing digits', () => {
    const rows = [
      row({ categoryId: 'a', categoryName: 'A', total: '123456789012345.67' }),
      row({ categoryId: 'b', categoryName: 'B', total: '123456789012345.66' }),
      row({ categoryId: 'c', categoryName: 'C', total: '0.01' }),
      row({ categoryId: 'd', categoryName: 'D', total: '0.02' }),
    ]

    const result = topCategories(rows, 2)

    // A and B differ only in the last place; a float sort could not tell them apart.
    expect(result).toEqual([
      { name: 'A', total: '123456789012345.6700' },
      { name: 'B', total: '123456789012345.6600' },
      { name: 'Other', total: '0.0300' },
    ])
  })

  it('folds 0.1 + 0.2 into Other exactly', () => {
    const rows = [
      row({ categoryId: 'a', categoryName: 'A', total: '5' }),
      row({ categoryId: 'b', categoryName: 'B', total: '0.1' }),
      row({ categoryId: 'c', categoryName: 'C', total: '0.2' }),
    ]

    expect(topCategories(rows, 1).at(-1)).toEqual({ name: 'Other', total: '0.3000' })
  })

  it('leaves out Other when the remainder is not positive', () => {
    const rows = [
      row({ categoryId: 'a', categoryName: 'A', total: '5' }),
      row({ categoryId: 'b', categoryName: 'B', total: '1' }),
      row({ categoryId: 'c', categoryName: 'C', total: '-1' }),
    ]

    expect(topCategories(rows, 2).map((c) => c.name)).toEqual(['A', 'B'])
  })
})
