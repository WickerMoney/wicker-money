import type { PluginQuery } from '../../plugins/PluginQuery.js'
import type { ExportRow } from './ExportRow.js'
import type { ExportTable } from './ExportTable.js'
import type { ExportedProfile } from './ExportedProfile.js'

/**
 * Whole-account reads for export, and the instance facts shown in Settings.
 * Every read is scoped to the current user by row-level security.
 */
export interface ExportRepository {
  /**
   * @param userId - The signed-in user.
   * @returns The user's profile without credentials, or `undefined` if the user does not exist.
   */
  readProfile(userId: string): Promise<ExportedProfile | undefined>

  /**
   * Reads one page of a table, ordered by id, for keyset paging.
   *
   * @param table - The table to read.
   * @param afterId - Return rows with an id greater than this; `undefined` starts from the beginning.
   * @param limit - Maximum rows to return.
   * @returns Up to `limit` rows in id order.
   */
  readPage(table: ExportTable, afterId: string | undefined, limit: number): Promise<ExportRow[]>

  /**
   * Runs `work` under a plugin's own database role, inside the current
   * transaction and therefore its snapshot.
   *
   * The role is assumed for the duration of `work` and released afterwards by
   * the host, so a plugin can read only what its manifest granted and cannot
   * leave the transaction wearing its identity. If `work` throws, the
   * transaction is already unusable and is rolled back by the caller.
   *
   * @param pluginId - The plugin's manifest id.
   * @param work - Plugin code, given a runner bound to the current user and role.
   * @returns Whatever `work` returns.
   */
  runAsPlugin<T>(pluginId: string, work: (q: PluginQuery) => Promise<T>): Promise<T>

  /**
   * @returns The name of the most recent migration that ran.
   * @throws When the migration table cannot be read; callers decide how to degrade.
   */
  latestMigrationName(): Promise<string | null>
}
