/** One legend entry. */
export interface DonutLegendItem {
  /** Category name shown in the legend row. */
  readonly name: string
  /** Amount for the category, as a decimal string. */
  readonly total: string
  /** CSS colour of the segment's swatch. */
  readonly colour: string
}

/** Props for {@link DonutLegend}. */
export interface DonutLegendProps {
  /** Legend entries, in the same order as the donut segments. */
  readonly items: readonly DonutLegendItem[]
  /** Index of the highlighted entry, or `null`. */
  readonly hover: number | null
  /** Called with the hovered entry index, or `null` when the pointer leaves. */
  readonly onHoverChange: (index: number | null) => void
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/**
 * The donut's legend, with each category's name and value in text ink beside its swatch.
 *
 * That text is the relief the palette validator requires: three light-mode slots
 * sit below 3:1 against the surface, so identity must not rest on colour alone.
 * It also keeps every figure readable without hovering anything.
 */
export function DonutLegend({ items, hover, onHoverChange, formatMoney }: DonutLegendProps) {
  return (
    <div className="viz__legend">
      {items.map((s, i) => (
        <div
          className={hover === i ? 'viz__legend-row is-active' : 'viz__legend-row'}
          key={s.name}
          onMouseEnter={() => onHoverChange(i)}
          onMouseLeave={() => onHoverChange(null)}
        >
          <span className="viz__swatch" style={{ background: s.colour }} />
          <span>{s.name}</span>
          <span className="viz__legend-value">{formatMoney(s.total)}</span>
        </div>
      ))}
    </div>
  )
}
