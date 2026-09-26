import type { PluginQuery } from '../../plugins/PluginQuery.js'

/** A bundled plugin's function that reads everything it stores for the current user. */
export type PluginExporter = (q: PluginQuery) => Promise<unknown>
