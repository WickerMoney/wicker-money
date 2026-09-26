import type { CORE_TABLES } from './CORE_TABLES.js'

/** One of the core tables a plugin may request access to. */
export type CoreTableName = (typeof CORE_TABLES)[number]
