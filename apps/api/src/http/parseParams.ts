import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { parseBody } from './parseBody.js'

/** Route params for a resource addressed by a single UUID `:id`. */
const idParams = z.object({ id: z.string().uuid('Must be a valid id.') })

/**
 * Reads and validates the `:id` route parameter.
 *
 * A malformed id would otherwise reach PostgreSQL and fail with an invalid-text
 * error, surfacing as a 500 instead of a 400.
 *
 * @param request - The incoming request.
 * @returns The id, guaranteed to be a UUID string.
 * @throws {ValidationError} When the parameter is missing or not a UUID.
 */
export function parseIdParam(request: FastifyRequest): string {
  return parseBody(idParams, request.params).id
}
