import type { RowError } from '../../shared/index.js'
import type { AnalyzedRow } from './AnalyzedRow.js'
import type { AnalyzeSummary } from './AnalyzeSummary.js'

/** The outcome of analysing a file, without writing anything. */
export interface AnalyzeResult {
  /** Counts by verdict. */
  readonly summary: AnalyzeSummary
  /** The first few per-row mapping errors. */
  readonly errors: readonly RowError[]
  /** Every mapped row with its verdict, in file order. */
  readonly rows: readonly AnalyzedRow[]
}
