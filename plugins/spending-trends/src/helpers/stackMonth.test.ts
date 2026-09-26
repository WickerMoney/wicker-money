import { describe, expect, it } from 'vitest'
import type { TrendMonth, TrendSeries } from '../models/index.js'
import { segmentPath } from './segmentPath.js'
import { stackExtent } from './stackExtent.js'
import { stackMonth } from './stackMonth.js'
import { tooltipAnchor } from './tooltipAnchor.js'
import { valueToY } from './valueToY.js'

const series = (id: string): TrendSeries => ({ id, name: id.toUpperCase(), total: '0.0000', folded: false })
const A = series('a')
const B = series('b')
const C = series('c')
const month = (values: Record<string, string>): TrendMonth => ({ month: '2026-08', values })
// Value v sits at y = 100 - v, so heights and positions can be read straight off the numbers.
const y = (v: number): number => 100 - v

describe('stackMonth', () => {
  it('stacks spending upward in rank order, with the first series as the base', () => {
    const segments = stackMonth(month({ a: '30', b: '20' }), [A, B], y)
    expect(segments).toEqual([
      { id: 'a', value: '30', y: 70, h: 30, rounding: 'none' },
      { id: 'b', value: '20', y: 50, h: 20, rounding: 'top' },
    ])
  })

  it('rounds only the outer end of the stack', () => {
    const segments = stackMonth(month({ a: '10', b: '10', c: '10' }), [A, B, C], y)
    expect(segments.map((s) => s.rounding)).toEqual(['none', 'none', 'top'])
  })

  it('draws nothing for a category with exactly zero, not a stub', () => {
    const segments = stackMonth(month({ a: '30', b: '0.0000', c: '-0.0000' }), [A, B, C], y)
    expect(segments.map((s) => s.id)).toEqual(['a'])
  })

  it('stacks a net refund downward from the zero line instead of dropping it', () => {
    const segments = stackMonth(month({ a: '30', b: '-10' }), [A, B], y)
    expect(segments).toEqual([
      { id: 'a', value: '30', y: 70, h: 30, rounding: 'top' },
      { id: 'b', value: '-10', y: 100, h: 10, rounding: 'bottom' },
    ])
  })

  it('draws a month of pure refunds', () => {
    const segments = stackMonth(month({ a: '-10', b: '-5' }), [A, B], y)
    expect(segments.map((s) => [s.id, s.y, s.h, s.rounding])).toEqual([
      ['a', 100, 10, 'none'],
      ['b', 110, 5, 'bottom'],
    ])
  })

  it('keeps a real amount at least one pixel tall', () => {
    expect(stackMonth(month({ a: '0.2' }), [A], y)[0]?.h).toBe(1)
  })

  it('ignores a series that is not visible', () => {
    expect(stackMonth(month({ a: '30', b: '20' }), [B], y).map((s) => s.id)).toEqual(['b'])
  })

  it('treats a series missing from the month as zero', () => {
    expect(stackMonth(month({ a: '30' }), [A, B], y).map((s) => s.id)).toEqual(['a'])
  })
})

describe('stackExtent', () => {
  it('finds the tallest stack up and the deepest down, over the visible series only', () => {
    const months = [month({ a: '30', b: '20', c: '-5' }), { month: '2026-09', values: { a: '10', b: '-40', c: '-5' } }]
    expect(stackExtent(months, [A, B, C])).toEqual({ maxUp: 50, maxDown: 45 })
    expect(stackExtent(months, [A])).toEqual({ maxUp: 30, maxDown: 0 })
  })

  it('is zero for no months', () => {
    expect(stackExtent([], [A])).toEqual({ maxUp: 0, maxDown: 0 })
  })
})

describe('valueToY', () => {
  it('maps the top of the axis to the top padding and the bottom to the bottom padding', () => {
    const toY = valueToY({ top: 100, bottom: -100, ticks: [] })
    expect(toY(100)).toBe(12)
    expect(toY(-100)).toBe(300 - 34)
    expect(toY(0)).toBe((12 + 266) / 2)
  })
})

describe('segmentPath', () => {
  it('is a plain rectangle when nothing is rounded', () => {
    expect(segmentPath(0, 0, 10, 10, 4, 'none')).toBe('M0,0 H10 V10 H0 Z')
  })

  it('rounds the top corners for the top of a stack', () => {
    expect(segmentPath(0, 0, 10, 10, 4, 'top')).toContain('M0,4 A4,4 0 0 1 4,0')
  })

  it('rounds the bottom corners for the bottom of a downward stack', () => {
    expect(segmentPath(0, 0, 10, 10, 4, 'bottom')).toContain('V6 A4,4 0 0 1 6,10')
  })

  it('shrinks the radius to fit a short segment rather than overshooting', () => {
    expect(segmentPath(0, 0, 10, 2, 4, 'top')).toContain('M0,2 A2,2')
  })

  it('falls back to a rectangle for a zero-width segment', () => {
    expect(segmentPath(0, 0, 0, 10, 4, 'top')).toBe('M0,0 H0 V10 H0 Z')
  })
})

describe('tooltipAnchor', () => {
  it('puts the tooltip to the right of a bar in the left half', () => {
    expect(tooltipAnchor(100, 50, 1000)).toEqual({ leftPercent: 16, side: 'right' })
  })

  it('puts the tooltip to the left of a bar in the right half', () => {
    expect(tooltipAnchor(800, 50, 1000)).toEqual({ leftPercent: 79, side: 'left' })
  })

  it('never lets the tooltip start over the bar it describes', () => {
    for (const left of [0, 200, 480, 520, 900]) {
      const { leftPercent, side } = tooltipAnchor(left, 60, 1000)
      const anchor = (leftPercent / 100) * 1000
      if (side === 'right') expect(anchor).toBeGreaterThan(left + 60)
      else expect(anchor).toBeLessThan(left)
    }
  })
})
