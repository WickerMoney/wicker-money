/** One category over one date range, to be measured by {@link SpendRepository.byCategoryRanges}. */
export interface CategoryRange {
  /** Caller's label for the result, unique within a call. */
  readonly key: string
  /** The category whose net spend is wanted. */
  readonly categoryId: string
  /** Inclusive start date, `YYYY-MM-DD`. */
  readonly start: string
  /** Exclusive end date, `YYYY-MM-DD`. */
  readonly end: string
}
