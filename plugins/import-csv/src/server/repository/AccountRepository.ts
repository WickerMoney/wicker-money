/** Read access to the accounts an import can target. */
export interface AccountRepository {
  /**
   * Checks whether an account is visible to the current user.
   *
   * Row-level security hides other people's accounts, so an id belonging to
   * someone else reads as absent.
   *
   * @param accountId - The account id.
   * @returns `true` when the user can see the account.
   */
  isVisible(accountId: string): Promise<boolean>
}
