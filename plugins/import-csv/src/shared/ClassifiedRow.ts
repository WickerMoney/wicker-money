import type { ExistingTransaction } from './ExistingTransaction.js'
import type { MappedRow } from './mapping.js'
import type { RowStatus } from './RowStatus.js'

/** A mapped row together with its duplicate-detection verdict. */
export interface ClassifiedRow {
  /** The mapped row being classified. */
  readonly row: MappedRow
  /** The verdict for this row. */
  readonly status: RowStatus
  /** The transaction this row matched, when it matched one. */
  readonly matched: ExistingTransaction | null
  /** A human-readable explanation, or `null` for a new row. */
  readonly reason: string | null
}
