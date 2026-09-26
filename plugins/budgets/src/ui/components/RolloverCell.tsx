import type { MonthLine } from '../models/index.js'

/** Props for {@link RolloverCell}. */
export interface RolloverCellProps {
  readonly line: MonthLine
  /** What the user has typed and not yet saved for this line, if anything. */
  readonly draftValue: string | undefined
  readonly busy: boolean
  /** Saves a line's plan and rollover setting. */
  readonly onSave: (line: MonthLine, planned: string, rollover: boolean) => void
}

/**
 * The checkbox that turns a line into a sinking fund.
 *
 * Toggling saves immediately, together with any plan the user has typed but not
 * yet committed, so flipping the box does not discard that edit.
 */
export function RolloverCell({ line, draftValue, busy, onSave }: RolloverCellProps) {
  return (
    <label className="check">
      <input
        type="checkbox"
        aria-label={`${line.categoryName} rolls over`}
        checked={line.rollover}
        disabled={busy}
        onChange={(e) => onSave(line, draftValue ?? line.planned, e.target.checked)}
      />
    </label>
  )
}
