/** Outcome of removing unused starter categories. */
export interface RemovalResult {
  /** Categories deleted. */
  readonly removed: number
  /** Names of categories left in place because something still points at them. */
  readonly kept: readonly string[]
}
