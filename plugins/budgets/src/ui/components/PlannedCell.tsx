import { useId } from 'react'
import { editableMoney, isZeroMoney } from '@wickermoney/plugin-sdk/money'
import type { MonthLine } from '../models/index.js'

/** Props for {@link PlannedCell}. */
export interface PlannedCellProps {
  readonly line: MonthLine
  /** What the user has typed and not yet saved for this line, if anything. */
  readonly draftValue: string | undefined
  /** Why the last save of this line's plan was refused, if it was. */
  readonly error?: string | undefined
  /** Records what the user is typing. */
  readonly onEditPlan: (categoryId: string, value: string) => void
  /** Saves a line's plan and rollover setting. */
  readonly onSave: (line: MonthLine, planned: string, rollover: boolean) => void
}

/**
 * The editable plan field for one line.
 *
 * The stored value is shown as money; what the user is typing is shown exactly
 * as typed, so the field does not reformat under the cursor mid-keystroke. The
 * edit is saved when the field loses focus, and Enter leaves the field.
 */
export function PlannedCell({ line, draftValue, error, onEditPlan, onSave }: PlannedCellProps) {
  const id = useId()
  // A window's amount belongs to the whole window, so it is changed in the
  // window form rather than inline in one month's row.
  if (line.window != null) {
    return <span className="bud__num">{isZeroMoney(line.planned) ? '—' : editableMoney(line.planned)}</span>
  }
  const stored = editableMoney(line.planned)
  const value = draftValue ?? stored
  // Under the field, in the row it belongs to: the page's banner is above the
  // month totals, a long way from a line near the bottom of the table.
  return (
    <span className="bud__plan-cell">
      <input
        className={`bud__plan${value !== stored ? ' is-dirty' : ''}`}
        inputMode="decimal"
        aria-label={`Planned for ${line.categoryName}`}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onEditPlan(line.categoryId, e.target.value)}
        onBlur={() => {
          if (value !== stored) onSave(line, value, line.rollover)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {error !== undefined ? <span className="wm-field__error" id={`${id}-error`}>{error}</span> : null}
    </span>
  )
}
