import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrendTooltip } from './TrendTooltip.js'

const month = { month: '2026-07', income: '100.0000', expense: '40.0000', net: '60.0000' }
const format = (v: string): string => `$${v}`

/** jsdom has no layout, so give the tooltip a width and the chart a box. */
function withLayout(tooltip: number, box: number): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(tooltip)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(box)
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement })
}

function shiftFor(leftPercent: number): number {
  const { container } = render(<div><TrendTooltip month={month} leftPercent={leftPercent} formatMoney={format} /></div>)
  return Number.parseFloat((container.querySelector('.viz__tip') as HTMLElement).style.marginLeft || '0')
}

describe('TrendTooltip', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('stays where it is when it fits', () => {
    withLayout(150, 600)
    expect(shiftFor(50)).toBe(0)
  })

  it('moves right when centring it would cross the left edge', () => {
    withLayout(150, 600) // centred at 3% = 18px, so its left edge would be at -57px
    expect(shiftFor(3)).toBe(57)
  })

  it('moves left when centring it would cross the right edge', () => {
    withLayout(150, 600) // centred at 97% = 582px, so its right edge would be at 657px
    expect(shiftFor(97)).toBe(-57)
  })

  it('lines up with the left edge when the chart is narrower than the tooltip', () => {
    withLayout(150, 100)
    expect(shiftFor(50)).toBe(25)
  })
})
