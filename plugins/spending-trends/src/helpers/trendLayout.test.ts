import { describe, expect, it } from 'vitest'
import { TREND_LAYOUT, trendLayout } from './TREND_LAYOUT.js'

describe('trendLayout', () => {
  it('is the full design width when the width is unknown, which is what every chart drew before', () => {
    expect(trendLayout(null)).toEqual(TREND_LAYOUT)
    expect(TREND_LAYOUT.width).toBe(1200)
    expect(TREND_LAYOUT.height).toBe(300)
    expect(TREND_LAYOUT.pad.left).toBe(76)
  })

  it('draws at the width it is shown at, so axis labels keep their size', () => {
    expect(trendLayout(900).width).toBe(900)
  })

  it('never draws wider than the design width, or narrower than a drawable sliver', () => {
    expect(trendLayout(3000).width).toBe(1200)
    expect(trendLayout(40).width).toBe(280)
  })

  it('uses a shorter box and a narrower label gutter on a phone', () => {
    const phone = trendLayout(340)
    expect(phone.height).toBeLessThan(TREND_LAYOUT.height)
    expect(phone.pad.left).toBeLessThan(TREND_LAYOUT.pad.left)
    expect(trendLayout(700).pad.left).toBe(76)
  })
})
