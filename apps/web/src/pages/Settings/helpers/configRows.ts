import type { ConfigInfo } from '../../../models/index.js'
import type { ConfigRow } from '../state/ConfigRow.js'

/**
 * Turns the configuration payload into display rows.
 *
 * @param config - The payload returned by the API.
 * @returns One row per setting, in display order.
 */
export function configRows(config: ConfigInfo): ConfigRow[] {
  return [
    { label: 'Environment', value: config.nodeEnv },
    { label: 'Log level', value: config.logLevel },
    { label: 'Port', value: String(config.port) },
    { label: 'Database', value: config.databaseName },
    { label: 'Application role', value: config.appRole },
    { label: 'Latest migration', value: config.latestMigration ?? '(unknown)' },
  ]
}
