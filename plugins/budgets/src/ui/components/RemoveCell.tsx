import { Button } from '@wickermoney/ui-kit'
import type { MonthLine } from '../models/index.js'

/** Props for {@link RemoveCell}. */
export interface RemoveCellProps {
  readonly line: MonthLine
  readonly busy: boolean
  readonly onRemove: (line: MonthLine) => void
}

/** The button that removes a saved line. A draft line has nothing stored to remove, so it shows none. */
export function RemoveCell({ line, busy, onRemove }: RemoveCellProps) {
  if (line.draft) return null
  return <Button disabled={busy} onClick={() => onRemove(line)}>Remove</Button>
}
