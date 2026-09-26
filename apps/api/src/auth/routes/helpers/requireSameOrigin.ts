import type { FastifyRequest } from 'fastify'
import { AppError } from '../../../errors.js'

/**
 * Rejects a state-changing request whose `Origin` header names another host.
 * Requests without an `Origin` (non-browser clients, same-origin GETs) pass.
 *
 * @param request - The incoming request.
 * @throws {AppError} With code `origin_mismatch` (403) if an `Origin` is present and its host differs from the request's.
 */
export async function requireSameOrigin(request: FastifyRequest): Promise<void> {
  if (request.method === 'GET' || request.method === 'HEAD') return
  const origin = request.headers.origin
  if (origin === undefined) return

  let originHost: string | undefined
  try {
    originHost = new URL(origin).host
  } catch {
    // An unparsable origin (including the literal "null") matches nothing.
  }
  if (originHost !== request.host) {
    throw new AppError('Cross-origin requests are not allowed.', 403, 'origin_mismatch')
  }
}
