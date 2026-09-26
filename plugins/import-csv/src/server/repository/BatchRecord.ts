/** The part of an import batch the revert flow needs. */
export interface BatchRecord {
  /** The batch id. */
  readonly id: string
  /** When the batch was reverted, or `null` if it has not been. */
  readonly revertedAt: Date | string | null
}
