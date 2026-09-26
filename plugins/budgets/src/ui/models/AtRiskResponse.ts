import type { MonthLine } from './MonthLine.js'

/** The response of `GET /at-risk`: the lines that need attention today, worst first. */
export interface AtRiskResponse {
  readonly monthKey: string
  readonly today: string
  /** `false` when the user has no budget for the month at all. */
  readonly planned: boolean
  /** Total number of lines in the month, including those that are fine. */
  readonly total?: number
  readonly lines: readonly MonthLine[]
  readonly summary?: { readonly spent: string; readonly available: string }
}
