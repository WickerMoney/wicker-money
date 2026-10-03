import { HORIZONS } from '../helpers/HORIZONS.js'
import type { ForecastHorizon } from '../models/index.js'

/** Props for {@link HorizonPicker}. */
export interface HorizonPickerProps {
  readonly value: ForecastHorizon
  readonly onChange: (value: ForecastHorizon) => void
}

/** A row of toggle buttons for how far ahead to look. */
export function HorizonPicker({ value, onChange }: HorizonPickerProps) {
  return (
    <div className="fc-seg" role="group" aria-label="How far ahead">
      {HORIZONS.map((h) => (
        <button
          key={h.value}
          type="button"
          className="fc-seg__btn"
          aria-pressed={h.value === value}
          onClick={() => onChange(h.value)}
        >
          {h.label}
        </button>
      ))}
    </div>
  )
}
