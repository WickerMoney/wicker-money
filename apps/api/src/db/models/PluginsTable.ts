import type { Generated } from 'kysely'
import type { TimestampWithDefault } from './columns.js'

/** An installed plugin and its per-instance settings. */
export interface PluginsTable {
  id: Generated<string>
  plugin_id: string
  version: string
  enabled: Generated<boolean>
  bundled: Generated<boolean>
  settings: Generated<Record<string, unknown>>
  installed_at: TimestampWithDefault
}
