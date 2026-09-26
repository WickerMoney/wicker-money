import type { FastifyRequest } from 'fastify'
import { AppError } from '../../../errors.js'
import { CSRF_HEADER } from './CSRF_HEADER.js'

/**
 * Rejects a request that lacks the anti-CSRF header.
 *
 * @param request - The incoming request.
 * @throws {AppError} With code `csrf_required` (403) unless the header is `1`.
 */
export function requireCsrfHeader(request: FastifyRequest): void {
  if (request.headers[CSRF_HEADER] !== '1') {
    throw new AppError(`The ${CSRF_HEADER}: 1 header is required.`, 403, 'csrf_required')
  }
}
