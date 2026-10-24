import type { InstanceActivity } from './InstanceActivity.js'

/**
 * Deleting a user's rows, and the two instance-wide operations behind the
 * danger zone. Row deletes run inside a unit of work for that user, so
 * row-level security has already narrowed each one to them; the `user_id`
 * condition in the SQL says the same thing again on purpose.
 */
export interface EraseRepository {
  /**
   * Locks the user's account row (`SELECT ... FOR UPDATE`) until the transaction ends.
   *
   * Every row a user owns points at that account row, and inserting one takes
   * a shared lock on it for the length of the writer's transaction. Taking the
   * stronger lock first therefore waits for any write that is open now, and
   * the deletes that follow see what it committed. Without it an open insert
   * is invisible to the erase and is committed after it.
   *
   * @param userId - The current user.
   */
  lockUser(userId: string): Promise<void>

  /**
   * @returns Every `schema.table` in `core` or a `plugin_` schema that has a
   *   `user_id` column, read from the catalog, sorted.
   */
  userTables(): Promise<readonly string[]>

  /**
   * Deletes the user's rows from one `core` table.
   *
   * @param table - A table name from the erase plan (unqualified).
   * @param userId - The current user.
   * @returns How many rows were deleted.
   * @throws {Error} If `table` is not in the erase plan.
   */
  deleteCoreRows(table: string, userId: string): Promise<number>

  /**
   * Deletes the user's rows from one table of a plugin's schema, under that
   * plugin's database role (assumed for the statement and released after it).
   *
   * @param pluginId - The plugin's manifest id.
   * @param table - A table name from that plugin's entry in the erase plan.
   * @param userId - The current user.
   * @returns How many rows were deleted.
   * @throws {Error} If the plugin or table is not in the erase plan.
   */
  deletePluginRows(pluginId: string, table: string, userId: string): Promise<number>

  /**
   * Deletes every session of the user, live or dead, which signs them out
   * everywhere: an access token is only good while its session family is live.
   *
   * @param userId - The current user.
   * @returns How many session rows were deleted.
   */
  deleteSessions(userId: string): Promise<number>

  /**
   * How many other sessions and accounts are live. Owner only; the database
   * refuses anyone else.
   *
   * @param excludeFamilyId - The caller's own session family, left out of the count.
   */
  instanceActivity(excludeFamilyId: string): Promise<InstanceActivity>

  /**
   * Empties every account and every plugin schema (`core.erase_instance`).
   * Owner only; the database refuses anyone else.
   */
  eraseInstance(): Promise<void>
}
