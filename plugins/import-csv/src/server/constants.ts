/** The plugin's identifier, used for its manifest, its routes and its client calls. */
export const IMPORT_PLUGIN_ID = 'wickermoney.import-csv'

/**
 * This plugin's endpoints, relative to the host's API root.
 *
 * Deliberately without the `/api/v1` prefix. The client the host injects adds
 * its own base, and the host mounts plugin routes under the same base on the
 * server, so a plugin that spells the version prefix itself gets
 * `/api/v1/api/v1/p/...` and a 404 that looks like the route was never
 * registered.
 */
export const IMPORT_API_BASE = `/p/${IMPORT_PLUGIN_ID}`
