/** The filters that narrow a listing of a user's transactions. */
export interface TransactionFilterCriteria {
  /** Only transactions on this account. */
  readonly accountId?: string
  /** Only transactions filed under this category or any of its children. */
  readonly categoryId?: string
  /** When true, only transactions with no category. */
  readonly uncategorizedOnly?: boolean
  /** Earliest transaction date, inclusive, as `YYYY-MM-DD`. */
  readonly from?: string
  /** Latest transaction date, inclusive, as `YYYY-MM-DD`. */
  readonly to?: string
  /** Case-insensitive substring of the merchant. Matched literally, never as a pattern. */
  readonly search?: string
}
