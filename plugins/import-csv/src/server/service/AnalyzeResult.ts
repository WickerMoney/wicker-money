import type { RowError } from '../../shared/index.js'
import type { AnalyzedRow } from './AnalyzedRow.js'
import type { AnalyzeSummary } from './AnalyzeSummary.js'
import type { FlaggedRows } from './FlaggedRows.js'

/** The outcome of analysing a file, without writing anything. */
export interface AnalyzeResult {
  /** Counts by verdict, for the whole file. */
  readonly summary: AnalyzeSummary
  /** The first few per-row mapping errors. */
  readonly errors: readonly RowError[]
  /**
   * The first `ANALYZE_PREVIEW_ROWS` (100) rows of the file with their verdicts,
   * in file order. Not every row: `summary` counts the rest.
   */
  readonly rows: readonly AnalyzedRow[]
  /** A page of the rows the user is asked to decide on. Ask again with an offset for the next page. */
  readonly flagged: FlaggedRows
}
