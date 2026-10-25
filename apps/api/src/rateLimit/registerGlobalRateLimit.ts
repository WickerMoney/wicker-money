import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors.js'
import type { Config } from '../config.js'
import { bucketOf, type RateLimitBucket } from './bucketOf.js'
import { callerKeyOf } from './callerKeyOf.js'
import type { RateLimitStore } from './RateLimitStore.js'

/** What each bucket is called in the message a person reads. */
const WHAT: Readonly<Record<RateLimitBucket, string>> = {
  general: 'requests',
  import: 'imports',
  export: 'exports',
}

/**
 * Adds the global per-user rate limit as an `onRequest` hook.
 *
 * Every request under `/api/v1/` counts against one bucket of its caller (see
 * {@link bucketOf} and {@link callerKeyOf}): the signed-in user, or the client
 * address for a request without a valid token. Over the bucket's allowance in
 * the window the request is refused with `429 rate_limited` and a
 * `Retry-After` header in seconds, before any handler runs: so a request
 * refused here never takes an import slot (`IMPORT_MAX_CONCURRENT`), a pooled
 * database connection or a hashing slot. The hook only counts; an accepted
 * request goes on to its own limits.
 *
 * This is separate from the sign-in limiter in `auth/routes`, which keeps its
 * own per-address and per-email counters and is not changed by this hook, and
 * from the password-attempt limiter on the erase and export-ticket routes. A
 * request can be counted by this hook and by one of those, and either may
 * refuse it.
 *
 * Does nothing when `API_RATE_LIMIT_ENABLED` is `false`. Register it before
 * the authentication hook so a plugin token refused there still counts.
 *
 * @param app - The Fastify instance.
 * @param config - Supplies the switch, the allowances and the window.
 * @param store - Where the counts are kept; defaults to nothing, so callers pass one.
 */
export function registerGlobalRateLimit(app: FastifyInstance, config: Config, store: RateLimitStore): void {
  if (!config.API_RATE_LIMIT_ENABLED) return
  const windowMs = config.API_RATE_LIMIT_WINDOW_SECONDS * 1000
  const allowance: Readonly<Record<RateLimitBucket, number>> = {
    general: config.API_RATE_LIMIT_MAX,
    import: config.API_RATE_LIMIT_IMPORT_MAX,
    export: config.API_RATE_LIMIT_EXPORT_MAX,
  }

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?', 1)[0] ?? ''
    const bucket = bucketOf(request.method, path, request.routeOptions.url)
    if (bucket === null) return
    const caller = await callerKeyOf(config, request)
    const { count, resetsInMs } = await store.hit(`${bucket}:${caller}`, windowMs)
    if (count <= allowance[bucket]) return
    const seconds = Math.max(1, Math.ceil(resetsInMs / 1000))
    throw new AppError(
      `Too many ${WHAT[bucket]}. Wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} and try again.`,
      429,
      'rate_limited',
      undefined,
      seconds,
    )
  })
}
