import type { Query } from './Query.js'

/**
 * Runs `fn` in one transaction as the given user, under this plugin's database role.
 *
 * The host supplies it; the plugin never sees a connection string or the
 * application's own database handle.
 */
export type RunAsPlugin = <T>(userId: string, fn: (q: Query) => Promise<T>) => Promise<T>
