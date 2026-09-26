import type { SummaryRow } from './SummaryRow.js'

/** The loading state of the monthly summary. */
export interface SummaryState {
  /** The loaded summary rows; empty until the first load completes. */
  readonly rows: readonly SummaryRow[]
  /** `true` while a load is in flight. */
  readonly loading: boolean
  /** A message when the load failed, otherwise `null`. */
  readonly error: string | null
}
