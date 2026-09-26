/** The outcome of copying the previous month's lines into a month. */
export interface AdoptResult {
  /** Lines created; 0 when the month already had a plan. */
  readonly created: number
  /** Lines the month already had, in which case nothing was written. */
  readonly alreadyPlanned: number
}
