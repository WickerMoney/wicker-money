/** Settings for {@link TransactionService}. */
export interface TransactionServiceOptions {
  /**
   * Seconds a deleted transaction stays restorable (`UNDO_TTL_SECONDS`). `0` or
   * unset turns Undo off: no snapshot is ever written.
   */
  readonly undoTtlSeconds?: number
}
