import type { Generated } from 'kysely'
import type { TimestampWithDefault } from './columns.js'

/** One row per API boot, recording the version that started. Not tenant data. */
export interface AppDeploymentsTable {
  id: Generated<string>
  version: string
  git_sha: string | null
  started_at: TimestampWithDefault
}
