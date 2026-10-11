import type { AccountRow, LiabilityAccountRow } from './AccountRow.js'

/** Read access to the user's core accounts, through the plugin's `accounts` grant. */
export interface AccountRepository {
  /** @returns The account, or `undefined` if the user has none with that id. */
  find(id: string): Promise<AccountRow | undefined>

  /**
   * @returns The user's loan and credit card accounts that are not archived,
   *   by name, each with the active debt that tracks it, if any.
   */
  listLiabilities(): Promise<LiabilityAccountRow[]>
}
