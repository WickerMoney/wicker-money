import type { Config } from '../../config.js'
import { appRole } from '../../db/migrations/005_app_role.js'
import type { ConfigInfo } from './ConfigInfo.js'
import { databaseNameFromUrl } from './databaseNameFromUrl.js'

/**
 * Assembles the allow-listed configuration values shown in Settings.
 *
 * @param config - The validated application configuration.
 * @param latestMigration - The latest migration name, or `null` if unknown.
 * @returns Only the fields of `ConfigInfo`, with no secrets.
 */
export function buildConfigInfo(config: Config, latestMigration: string | null): ConfigInfo {
  return {
    nodeEnv: config.NODE_ENV,
    logLevel: config.LOG_LEVEL,
    port: config.PORT,
    databaseName: databaseNameFromUrl(config.DATABASE_URL),
    appRole: appRole(),
    latestMigration,
  }
}
