import type { TrendSeries } from '../models/index.js'

/** Props for {@link SeriesFilter}. */
export interface SeriesFilterProps {
  /** Every series, in rank order. */
  readonly series: readonly TrendSeries[]
  /** Each series' colour by id. */
  readonly colors: ReadonlyMap<string, string>
  /** The ids currently turned off. */
  readonly hidden: ReadonlySet<string>
  /** Turns a series off, or back on. */
  readonly onToggle: (id: string) => void
  /** Formats a decimal-string amount for display. */
  readonly formatMoney: (value: string) => string
}

/**
 * The chart's legend and its filter in one: a toggle per category.
 *
 * Each chip carries the category's name and its total over the range in text
 * ink beside the swatch, so identity never rests on colour alone; the palette's
 * lighter slots are below the contrast a bare swatch would need on a light
 * surface. A hidden category keeps its chip, with an outlined swatch, so it can
 * be turned back on.
 *
 * Toggle buttons, not a checkbox group: `aria-pressed` says what a screen
 * reader needs, that pressing the control shows or hides the category.
 */
export function SeriesFilter({ series, colors, hidden, onToggle, formatMoney }: SeriesFilterProps) {
  return (
    <div className="spt__filters" role="group" aria-label="Filter categories">
      {series.map((s) => {
        const off = hidden.has(s.id)
        const color = colors.get(s.id) ?? 'currentColor'
        return (
          <button
            key={s.id}
            type="button"
            className={off ? 'spt__chip is-off' : 'spt__chip'}
            aria-pressed={!off}
            onClick={() => onToggle(s.id)}
          >
            <span
              className="spt__swatch"
              aria-hidden="true"
              style={off ? { borderColor: color } : { background: color, borderColor: color }}
            />
            <span>{s.name}</span>
            <span className="spt__chip-value">{formatMoney(s.total)}</span>
          </button>
        )
      })}
    </div>
  )
}
