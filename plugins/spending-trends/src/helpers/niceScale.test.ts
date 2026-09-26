import { describe, expect, it } from 'vitest'
import { niceScale } from './niceScale.js'
import { niceStep } from './niceStep.js'

describe('niceStep', () => {
  it.each([
    [1800, 2000],
    [2750, 5000],
    [900, 1000],
    [4, 5],
    [12, 20],
  ])('rounds %d up to %d', (raw, expected) => expect(niceStep(raw)).toBe(expected))

  it('never goes below a whole unit, because tick labels are whole units', () => {
    expect(niceStep(0.1)).toBe(1)
    expect(niceStep(0)).toBe(1)
    expect(niceStep(-5)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
  })

  it('is always an integer', () => {
    for (const raw of [1.1, 2.4, 3.3, 7.7, 24, 240, 2400]) {
      expect(Number.isInteger(niceStep(raw))).toBe(true)
    }
  })
})

describe('niceScale', () => {
  it('ends on round numbers and starts at zero when nothing goes below', () => {
    expect(niceScale(7200, 0)).toEqual({ top: 8000, bottom: 0, ticks: [0, 2000, 4000, 6000, 8000] })
  })

  it('makes room below zero for a refund, and keeps zero as a tick', () => {
    const scale = niceScale(3000, 500)
    expect(scale.bottom).toBe(-1000)
    expect(scale.top).toBe(3000)
    expect(scale.ticks).toContain(0)
    expect(scale.ticks[0]).toBe(-1000)
  })

  it('handles a chart that is all refunds', () => {
    expect(niceScale(0, 250)).toEqual({ top: 0, bottom: -250, ticks: [-250, -200, -150, -100, -50, 0] })
  })

  it('fits the axis to the data instead of rounding a step up and wasting the plot', () => {
    // A 5,000 step would end this axis at 15,000.
    expect(niceScale(10950, 0)).toEqual({ top: 12000, bottom: 0, ticks: [0, 2000, 4000, 6000, 8000, 10000, 12000] })
  })

  it('never has more than six intervals', () => {
    for (const [up, down] of [[99, 12], [12345, 678], [1e6, 1e5], [7, 7], [3, 40000], [0.4, 0]] as const) {
      expect(niceScale(up, down).ticks.length - 1).toBeLessThanOrEqual(6)
    }
  })

  it('returns a finite axis when there is nothing to plot', () => {
    expect(niceScale(0, 0)).toEqual({ top: 1, bottom: 0, ticks: [0, 1] })
  })

  it('never cuts a stack off', () => {
    for (const [up, down] of [[1, 0], [99, 12], [12345, 678], [0.4, 0], [1e6, 1e5]] as const) {
      const scale = niceScale(up, down)
      expect(scale.top).toBeGreaterThanOrEqual(up)
      expect(scale.bottom).toBeLessThanOrEqual(-down)
      expect(scale.ticks.every((t) => Number.isInteger(t))).toBe(true)
    }
  })
})
