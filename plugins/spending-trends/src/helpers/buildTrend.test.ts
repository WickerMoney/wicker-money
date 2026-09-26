import { describe, expect, it } from 'vitest'
import type { SummaryRow } from '../models/index.js'
import { buildTrend } from './buildTrend.js'
import { hasSpending } from './hasSpending.js'

const row = (
  month: string, id: string | null, name: string, total: string, kind: SummaryRow['kind'] = 'expense',
): SummaryRow => ({ month, categoryId: id, categoryName: name, kind, total })

describe('refunds are real, and negative', () => {
  // A month whose refunds exceed a category's spending has a negative total.
  // Every comparison against zero in this plugin is a decision, so the sign case
  // is pinned before anything else.
  it('keeps a net refund as a negative amount instead of clamping it to zero', () => {
    const trend = buildTrend([row('2026-08', 'a', 'Groceries', '-25.00')])
    expect(trend.months[0]?.values['a']).toBe('-25.0000')
  })

  it('counts a month of pure refunds as something to draw', () => {
    expect(hasSpending(buildTrend([row('2026-08', 'a', 'Groceries', '-25.00')]))).toBe(true)
  })

  it('says there is nothing to draw when a category nets to exactly zero', () => {
    const trend = buildTrend([
      row('2026-08', 'a', 'Groceries', '40.00'),
      row('2026-08', 'a', 'Groceries', '-40.00'),
    ])
    expect(hasSpending(trend)).toBe(false)
  })

  it('lets a folded category carry a negative net into Other', () => {
    const trend = buildTrend(
      [
        row('2026-08', 'a', 'A', '100.00'),
        row('2026-08', 'b', 'B', '50.00'),
        row('2026-08', 'c', 'C', '-30.00'),
      ],
      { limit: 2 },
    )
    expect(trend.series.map((s) => s.id)).toEqual(['a', 'b', '__other'])
    expect(trend.months[0]?.values['__other']).toBe('-30.0000')
  })
})

describe('ranking', () => {
  const rows = [
    row('2026-07', 'a', 'Groceries', '120.00'),
    row('2026-07', 'b', 'Transport', '40.00'),
    row('2026-08', 'a', 'Groceries', '90.00'),
    row('2026-08', 'c', 'Dining', '300.00'),
  ]

  it('puts the largest category first, so it is the base of every bar', () => {
    expect(buildTrend(rows).series.map((s) => [s.name, s.total])).toEqual([
      ['Dining', '300.0000'],
      ['Groceries', '210.0000'],
      ['Transport', '40.0000'],
    ])
  })

  it('breaks a tie on name, not on the order the server sent', () => {
    const tie = [row('2026-07', 'z', 'Zoo', '10.00'), row('2026-07', 'a', 'Art', '10.00')]
    expect(buildTrend(tie).series.map((s) => s.name)).toEqual(['Art', 'Zoo'])
    expect(buildTrend([...tie].reverse()).series.map((s) => s.name)).toEqual(['Art', 'Zoo'])
  })

  it('skips income: this is where the money went', () => {
    const trend = buildTrend([...rows, row('2026-07', 's', 'Salary', '5000.00', 'income')])
    expect(trend.series.some((s) => s.name === 'Salary')).toBe(false)
  })

  it('treats a row with no kind, from an older server, as spending', () => {
    const legacy = { month: '2026-07', categoryId: 'a', categoryName: 'Old', total: '10.00' } as unknown as SummaryRow
    expect(buildTrend([legacy]).series.map((s) => s.name)).toEqual(['Old'])
  })

  it('keys on the id, so two categories with one name stay two series', () => {
    const trend = buildTrend([
      row('2026-07', 'p1', 'Other stuff', '10.00'),
      row('2026-07', 'p2', 'Other stuff', '20.00'),
    ])
    expect(trend.series.map((s) => s.id)).toEqual(['p2', 'p1'])
  })

  it('gives uncategorized spending a series of its own', () => {
    const trend = buildTrend([row('2026-07', null, 'Uncategorized', '15.00')])
    expect(trend.series).toEqual([
      { id: 'uncategorized', name: 'Uncategorized', total: '15.0000', folded: false },
    ])
  })
})

describe('the Other fold', () => {
  const many: SummaryRow[] = Array.from({ length: 9 }, (_, i) => (
    row('2026-08', `c${i}`, `Cat ${i}`, String(100 - i * 10))
  ))

  it('names five by default and folds the rest, because the palette has five slots', () => {
    const { series } = buildTrend(many)
    expect(series).toHaveLength(6)
    expect(series[5]).toEqual({ id: '__other', name: 'Other', total: '140.0000', folded: true })
  })

  it('omits Other when nothing is left over', () => {
    expect(buildTrend(many.slice(0, 5)).series.some((s) => s.folded)).toBe(false)
  })

  it('keeps every bar equal to the whole month, whatever was folded', () => {
    const { months } = buildTrend(many, { limit: 2 })
    const sum = Object.values(months[0]?.values ?? {}).reduce((a, v) => a + Math.round(Number(v) * 100), 0)
    expect(sum).toBe(Math.round(many.reduce((a, r) => a + Number(r.total), 0) * 100))
  })

  it('sums exactly, so 0.1 and 0.2 make 0.3', () => {
    const trend = buildTrend([row('2026-07', 'a', 'A', '0.1'), row('2026-07', 'a', 'A', '0.2')])
    expect(trend.months[0]?.values['a']).toBe('0.3000')
  })
})

describe('months', () => {
  const sparse = [row('2026-03', 'a', 'A', '100.00'), row('2026-09', 'a', 'A', '200.00')]

  it('fills every month the range covers, with zeros, so a gap stays a gap', () => {
    const trend = buildTrend(sparse, { expected: ['2026-07', '2026-08', '2026-09'] })
    expect(trend.months.map((m) => [m.month, m.values['a']])).toEqual([
      ['2026-07', '0.0000'],
      ['2026-08', '0.0000'],
      ['2026-09', '200.0000'],
    ])
  })

  it('collapses the gap without a range, oldest first', () => {
    expect(buildTrend([...sparse].reverse()).months.map((m) => m.month)).toEqual(['2026-03', '2026-09'])
  })

  it('gives every series an entry in every month', () => {
    const trend = buildTrend([row('2026-07', 'a', 'A', '1'), row('2026-08', 'b', 'B', '1')])
    for (const m of trend.months) expect(Object.keys(m.values).sort()).toEqual(['a', 'b'])
  })

  it('rejects a total that is not a number instead of drawing NaN', () => {
    expect(() => buildTrend([row('2026-07', 'a', 'A', 'abc')])).toThrow(RangeError)
  })

  it('has nothing to draw for no rows', () => {
    expect(hasSpending(buildTrend([]))).toBe(false)
  })
})
