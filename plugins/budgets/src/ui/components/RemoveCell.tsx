import { Button } from '@wickermoney/ui-kit'
import type { MonthLine } from '../models/index.js'

/** Props for {@link RemoveCell}. */
export interface RemoveCellProps {
  readonly line: MonthLine
  readonly busy: boolean
  readonly onRemove: (line: MonthLine) => void
  /** Opens a window in the window form. Only windows get an Edit button. */
  readonly onEdit?: (line: MonthLine) => void
}

/**
 * The button that removes a saved line. A draft line has nothing stored to
 * remove, so it shows none. A window also gets an Edit button, and Remove
 * takes the whole window away, not just this month.
 */
export function RemoveCell({ line, busy, onRemove, onEdit }: RemoveCellProps) {
  if (line.draft) return null
  if (line.window != null) {
    return (
      <span className="bud__row-actions">
        {onEdit !== undefined ? <Button disabled={busy} onClick={() => onEdit(line)}>Edit</Button> : null}
        <Button disabled={busy} onClick={() => onRemove(line)}>Remove window</Button>
      </span>
    )
  }
  return <Button disabled={busy} onClick={() => onRemove(line)}>Remove</Button>
}
