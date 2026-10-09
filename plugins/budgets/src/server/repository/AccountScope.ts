/**
 * One thing to measure account spending for: an account, a date range, and the
 * categories that do not count. Stored account lines and drafts previewed from
 * the month before are both asked about this way, so a draft's spending uses
 * the same query as a stored line's.
 */
export interface AccountScope {
  /** Caller-chosen key the result is returned under, unique within one call. */
  readonly key: string
  readonly accountId: string
  /** Inclusive start date, `YYYY-MM-DD`. */
  readonly start: string
  /** Exclusive end date, `YYYY-MM-DD`. */
  readonly end: string
  /** Categories whose spending is left out of this scope. */
  readonly excluded: readonly string[]
}
