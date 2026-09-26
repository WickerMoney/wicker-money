/** The caller's instruction to move an account's history, guarded by the count they saw. */
export interface MigrationConfirmation {
  /** The account that receives the history. */
  readonly toAccountId: string
  /** The number of affected rows the caller was shown; the migration is refused if it has changed. */
  readonly confirmCount: number
}
