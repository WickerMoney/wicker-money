import type { ClassifiedRow } from '../../shared/index.js'

/**
 * Chooses which classified rows are written.
 *
 * New rows are imported. A flagged row is imported only when the user accepted
 * its row number; a duplicate never is.
 *
 * @param classified - Every classified row.
 * @param accepted - Row numbers the user confirmed despite a heuristic match.
 * @returns The rows to write, in file order.
 */
export function selectRowsToImport(
  classified: readonly ClassifiedRow[],
  accepted: ReadonlySet<number>,
): ClassifiedRow[] {
  return classified.filter(
    (c) => c.status === 'new' || (c.status === 'needs-review' && accepted.has(c.row.rowNumber)),
  )
}
