import type { FastifyRequest } from 'fastify'

/**
 * A check run at the start of a core data route.
 *
 * Resolves to the authenticated user's id when the request is allowed, and
 * throws otherwise.
 */
export type TableGrantGuard = (request: FastifyRequest) => Promise<{ userId: string }>
