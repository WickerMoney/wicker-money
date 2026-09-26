/** Serialises concurrent imports into the same account. */
export interface ImportLockRepository {
  /**
   * Takes a lock on one user's account that is held until the transaction ends.
   *
   * A second import into the same account waits here until the first commits or
   * rolls back, so it classifies against everything the first wrote. Without it
   * two overlapping uploads of the same file both see an empty ledger.
   *
   * @param userId - The importing user.
   * @param accountId - The target account.
   */
  lockAccount(userId: string, accountId: string): Promise<void>
}
