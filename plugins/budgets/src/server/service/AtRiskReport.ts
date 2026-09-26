import type { LineStatus } from '../../shared/index.js'

/** The current month's lines ranked by how much trouble they are in. */
export interface AtRiskReport {
  readonly monthKey: string
  /** Today's date in the user's zone, `YYYY-MM-DD`. */
  readonly today: string
  /** False when the month has no lines at all; `lines` is then empty. */
  readonly planned: boolean
  /** Number of lines in the month, including those that are fine. Present when `planned`. */
  readonly total?: number
  /** The lines that are over or at risk, worst first, capped for a dashboard tile. */
  readonly lines: readonly LineStatus[]
  /** Spent and available across every line, not only the ranked ones. Present when `planned`. */
  readonly summary?: { readonly spent: string; readonly available: string }
}
