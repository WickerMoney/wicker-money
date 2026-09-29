import type { LegAccount } from './LegAccount.js'
import type { RecurringItemRow } from './RecurringItemRow.js'
import type { RecurringItemWrite } from './RecurringItemWrite.js'

/**
 * Persistence for recurring items and their legs. Every method runs inside the
 * unit of work's transaction, under the acting user's row-level security, so
 * none of them take a user id to filter by.
 */
export interface RecurringItemRepository {
  /**
   * Lists every recurring item the user owns, with its legs.
   *
   * @returns Items ordered by name, then id.
   */
  list(): Promise<RecurringItemRow[]>

  /**
   * Finds one item with its legs.
   *
   * @param id - Item id.
   * @returns The item, or `undefined` if it does not exist for this user.
   */
  find(id: string): Promise<RecurringItemRow | undefined>

  /**
   * Inserts an item and its legs. The legs trigger checks their shape at commit.
   *
   * @param userId - Owner.
   * @param item - Columns and legs.
   * @returns The new item's id.
   */
  insert(userId: string, item: RecurringItemWrite): Promise<string>

  /**
   * Rewrites an item: every column and the whole set of legs. Edits rewrite
   * the series; there is no history to keep.
   *
   * @param userId - Owner, for the new leg rows.
   * @param id - Item id.
   * @param item - Columns and legs.
   * @returns `false` if the item does not exist for this user.
   */
  replace(userId: string, id: string, item: RecurringItemWrite): Promise<boolean>

  /**
   * Sets an item's end date and nothing else.
   *
   * @param id - Item id.
   * @param endDate - Last date an occurrence may fall on, `YYYY-MM-DD`.
   * @returns `false` if the item does not exist for this user.
   */
  setEndDate(id: string, endDate: string): Promise<boolean>

  /**
   * Deletes an item; its legs cascade.
   *
   * @param id - Item id.
   * @returns `false` if the item did not exist for this user.
   */
  delete(id: string): Promise<boolean>

  /**
   * Looks up the accounts that legs would be written to.
   *
   * @param ids - Account ids.
   * @returns The ones that exist for this user, with type and archived state.
   */
  findAccounts(ids: readonly string[]): Promise<LegAccount[]>

  /**
   * Checks which categories exist for this user.
   *
   * @param ids - Category ids.
   * @returns The subset that exists.
   */
  findCategoryIds(ids: readonly string[]): Promise<Set<string>>
}
