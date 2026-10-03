/** What a caller records about one occurrence. Every field replaces what was there. */
export interface OccurrenceOverrideInput {
  /** `true` when it will not happen. */
  readonly skipped: boolean
  /** When it is expected instead of the nominal date, or `null` for on schedule. */
  readonly expectedDate: string | null
  /**
   * Signed amounts for this occurrence, one per account, on accounts the item
   * has legs on. A leg left out keeps the item's amount. `null` or empty keeps
   * every leg's amount.
   */
  readonly legs: readonly { readonly accountId: string; readonly amount: string }[] | null
}
