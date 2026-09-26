import type { Kysely } from 'kysely'

/** Connection a migration step runs on: the migrator's handle or a transaction opened from it. */
export type Executor = Kysely<unknown>
