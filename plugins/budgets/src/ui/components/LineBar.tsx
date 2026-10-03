import { elapsedFraction, type Health } from '../../shared/index.js'
import { HEALTH_CLASS } from '../helpers/healthClass.js'

/** Props for {@link LineBar}. */
export interface LineBarProps {
  /** Fraction of the line's available amount spent so far. Values above 1 are clamped. */
  readonly used: number
  readonly health: Health
  /** The month being shown, `YYYY-MM`. */
  readonly monthKey: string
  /** Today's date, `YYYY-MM-DD`; positions the pace mark. */
  readonly today: string
  /**
   * Where the pace mark goes, as a fraction of the line's period, when the
   * period is not the calendar month (a window). Overrides `monthKey`/`today`.
   */
  readonly elapsed?: number
  /** Accessible description of the bar. */
  readonly label: string
  /**
   * The thinner, edge-to-edge bar the dashboard tiles use (the marketing
   * site's budget tile), rather than the inset bar of the budgets table.
   */
  readonly slim?: boolean
}

/**
 * One line's spend against what it has, with today's position marked on it.
 *
 * The mark is the point of the component: a bar at 80% is either fine or
 * alarming depending on what day it is, and the bar alone cannot say which.
 * Marking how far the month has got turns one number into a comparison that can
 * be made at a glance.
 *
 * The fill is capped at 100% of the track so an overspent line stays inside it;
 * the colour, not the geometry, carries "over".
 */
export function LineBar({ used, health, monthKey, today, label, slim = false, elapsed: given }: LineBarProps) {
  const fill = Math.max(0, Math.min(1, used))
  const elapsed = given ?? elapsedFraction(monthKey, today)

  return (
    <div
      className={slim ? 'bud__bar bud__bar--slim' : 'bud__bar'}
      role="img"
      aria-label={label}
      title={label}
    >
      <div
        className={`bud__bar-fill ${HEALTH_CLASS[health]}`}
        style={{ width: slim ? `${(fill * 100).toFixed(1)}%` : `calc(${(fill * 100).toFixed(1)}% - 4px)` }}
      />
      {elapsed > 0 && elapsed < 1 ? (
        <div className="bud__bar-pace" style={{ left: `${(elapsed * 100).toFixed(1)}%` }} />
      ) : null}
    </div>
  )
}
