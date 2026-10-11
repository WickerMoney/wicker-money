import { useLayoutEffect, useRef, useState } from 'react'
import { absMoney, isNegativeMoney } from '@wickermoney/plugin-sdk/money'
import { monthLabelLong } from '../helpers/monthLabel.js'
import type { MonthTotal } from '../models/index.js'

/** Props for {@link TrendTooltip}. */
export interface TrendTooltipProps {
  /** The month whose totals are shown. */
  readonly month: MonthTotal
  /** Horizontal position as a percentage of the chart width. */
  readonly leftPercent: number
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/**
 * The readout shown above the hovered or focused month in the income/spending chart.
 *
 * It is centred on the month and then moved back inside the chart's own box when
 * that would push it past either edge. The first and last months sit near the
 * edges, and a tooltip that hangs outside the chart is cut off by whatever
 * contains it: the card on a phone, and always the frame when the widget runs in
 * a sandboxed one, because a frame has no way to draw outside its own rectangle.
 */
export function TrendTooltip({ month, leftPercent, formatMoney }: TrendTooltipProps) {
  const down = isNegativeMoney(month.net)
  const tip = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = tip.current
    const box = el?.offsetParent
    if (el === null || el === undefined || !(box instanceof HTMLElement)) return
    const half = el.offsetWidth / 2
    const centre = (leftPercent / 100) * box.clientWidth
    // When the box is narrower than the tooltip, line up with the left edge.
    const clamped = Math.max(half, Math.min(centre, box.clientWidth - half))
    setShift(clamped - centre)
  }, [leftPercent, month])
  return (
    <div ref={tip} className="viz__tip" style={{ left: `${leftPercent}%`, top: 0, marginLeft: shift }}>
      <span className="viz__tip-label">{monthLabelLong(month.month)}</span>
      <span className="viz__tip-row">
        <span className="viz__swatch" style={{ background: 'var(--viz-1)' }} />
        <strong>{formatMoney(month.income)}</strong> in
      </span>
      <span className="viz__tip-row">
        <span className="viz__swatch" style={{ background: 'var(--viz-2)' }} />
        <strong>{formatMoney(month.expense)}</strong> out
      </span>
      <span className={`viz__tip-net${down ? ' is-neg' : ''}`}>
        {down ? 'Down ' : 'Up '}
        <strong>{formatMoney(absMoney(month.net))}</strong>
      </span>
    </div>
  )
}
