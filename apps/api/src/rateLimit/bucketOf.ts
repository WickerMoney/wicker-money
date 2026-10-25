/** Which allowance a request counts against. */
export type RateLimitBucket = 'general' | 'import' | 'export'

/** Routes with a stricter bucket of their own, by method and registered pattern. */
const STRICT: Readonly<Record<string, RateLimitBucket>> = {
  'POST /api/v1/p/wickermoney.import-csv/analyze': 'import',
  'POST /api/v1/p/wickermoney.import-csv/commit': 'import',
  'GET /api/v1/settings/export': 'export',
}

/**
 * Decides which bucket a request counts against, or that it is not limited.
 *
 * Only paths under `/api/v1/` are limited. The health checks, the web bundle,
 * its static assets and the plugin frame document are never counted. Within the
 * API a request counts against exactly one bucket: the import and export
 * routes in their stricter one, everything else (including the export ticket
 * and the erase actions, which keep their own password-attempt limiter as well)
 * in the general one.
 *
 * @param method - HTTP method.
 * @param path - Request path without the query string.
 * @param pattern - The route's registered pattern, when one matched.
 * @returns The bucket, or `null` for a request that is not limited.
 */
export function bucketOf(method: string, path: string, pattern: string | undefined): RateLimitBucket | null {
  if (!path.startsWith('/api/v1/')) return null
  if (pattern === undefined) return 'general'
  return STRICT[`${method} ${pattern}`] ?? 'general'
}
