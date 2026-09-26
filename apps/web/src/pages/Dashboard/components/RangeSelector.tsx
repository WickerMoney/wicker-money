import { RANGE_KEYS, rangeLabel, type RangeKey } from '@wickermoney/plugin-sdk'

/** Props for {@link RangeSelector}. */
export interface RangeSelectorProps {
  /** The currently selected range. */
  readonly value: RangeKey
  /** Called with the newly chosen range. */
  readonly onChange: (key: RangeKey) => void
}

/** A segmented control for choosing the dashboard's time range. */
export function RangeSelector({ value, onChange }: RangeSelectorProps) {
  return (
    <div className="range" role="group" aria-label="Time range">
      {RANGE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={`range__option${key === value ? ' is-on' : ''}`}
          aria-pressed={key === value}
          onClick={() => onChange(key)}
        >
          {rangeLabel(key)}
        </button>
      ))}
    </div>
  )
}
