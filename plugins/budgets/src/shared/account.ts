/**
 * Account lines: an allowance measured against one account (see migration 027
 * and `docs`), reported in the same shape as a category line so the dashboard's
 * tiles, bars and ranking need no second code path.
 */

/** Most categories one account line may exclude. Matches the table's CHECK. */
export const MAX_EXCLUDED_CATEGORIES = 50

/** Account types an allowance may be set on. */
export const ACCOUNT_LINE_TYPES: readonly string[] = ['checking']

/**
 * The id a status row carries in place of a category id.
 *
 * The shared line shape is keyed on `categoryId`. An account line has no
 * category, so its row is keyed `account:<accountId>`: still unique among a
 * month's rows, and it cannot collide with a category's UUID.
 *
 * @param accountId - The account the line is on.
 * @returns The key to use as the row's `categoryId`.
 */
export function accountTileId(accountId: string): string {
  return `account:${accountId}`
}

/**
 * @param categoryId - A status row's `categoryId`.
 * @returns Whether the row is an account line rather than a category line.
 */
export function isAccountTile(categoryId: string): boolean {
  return categoryId.startsWith('account:')
}

/**
 * What an account line is called on a tile or in a table.
 *
 * @param accountName - The account's name.
 * @returns The name with what it measures, such as `Joint Checking spending`.
 */
export function accountTileLabel(accountName: string): string {
  return `${accountName} spending`
}
