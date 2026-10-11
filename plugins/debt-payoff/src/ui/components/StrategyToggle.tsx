import type { Strategy } from '../../shared/index.js'
import { STRATEGY_INFO } from '../helpers/STRATEGY_INFO.js'

/** Props for {@link StrategyToggle}. */
export interface StrategyToggleProps {
  readonly value: Strategy
  readonly disabled: boolean
  readonly onChange: (value: Strategy) => void
}

const ORDER: readonly Strategy[] = ['avalanche', 'snowball']

/**
 * Snowball or avalanche, as two toggle buttons.
 *
 * The group and each button's pressed state are announced; the sentence under
 * them says what the chosen one does, so the choice is never a bare label.
 */
export function StrategyToggle({ value, disabled, onChange }: StrategyToggleProps) {
  return (
    <div className="dp-strategy">
      <div className="dp-seg" role="group" aria-label="Payoff strategy">
        {ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className="dp-seg__btn"
            aria-pressed={s === value}
            disabled={disabled}
            onClick={() => onChange(s)}
          >
            {STRATEGY_INFO[s].label}
          </button>
        ))}
      </div>
      <p className="dp-muted dp-strategy__about">{STRATEGY_INFO[value].summary}</p>
    </div>
  )
}
