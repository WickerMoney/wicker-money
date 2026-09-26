import type { ClassifySummary } from '../../shared/index.js'

/** Row counts by verdict, plus the number of rows that could not be mapped. */
export interface AnalyzeSummary extends ClassifySummary {
  /** Rows that failed mapping. */
  readonly errors: number
}
