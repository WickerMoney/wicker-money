import type { ClassifiedRow } from '../../shared/index.js'
import type { AnalyzePage } from './AnalyzePage.js'

/**
 * Picks one page of the rows that need the user's decision.
 *
 * @param classified - Every classified row, in file order.
 * @param page - How many flagged rows to skip and the most to return.
 * @returns Rows whose status is `needs-review`, in file order. Stops reading as
 *   soon as the page is full, so a file with 100,000 flagged rows is not copied.
 */
export function pageOfFlagged(classified: readonly ClassifiedRow[], page: AnalyzePage): ClassifiedRow[] {
  const out: ClassifiedRow[] = []
  let skipped = 0
  for (const row of classified) {
    if (row.status !== 'needs-review') continue
    if (skipped < page.offset) {
      skipped++
      continue
    }
    out.push(row)
    if (out.length === page.limit) break
  }
  return out
}
