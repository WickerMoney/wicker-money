import { Button } from '@wickermoney/ui-kit'
import { monthLabel } from '../helpers/monthLabel.js'

/** Props for {@link MonthNavigator}. */
export interface MonthNavigatorProps {
  /** The month being shown, `YYYY-MM`. */
  readonly monthKey: string
  /** `true` when the month is showing an unsaved preview of the previous month's lines. */
  readonly draft: boolean
  readonly onPrevious: () => void
  readonly onNext: () => void
  readonly onThisMonth: () => void
}

/** Previous/next/this-month controls and the draft badge above a month's figures. */
export function MonthNavigator({ monthKey, draft, onPrevious, onNext, onThisMonth }: MonthNavigatorProps) {
  return (
    <div className="bud__month">
      <Button onClick={onPrevious}>← Previous</Button>
      <span className="bud__month-label">{monthLabel(monthKey)}</span>
      <Button onClick={onNext}>Next →</Button>
      <Button onClick={onThisMonth}>This month</Button>
      {draft ? <span className="bud__badge">Draft — nothing saved yet</span> : null}
    </div>
  )
}
