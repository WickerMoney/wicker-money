import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerListUsers } from './handlers/listUsers.js'
import { registerSetUserRole } from './handlers/setUserRole.js'

/**
 * Registers the owner-only account administration endpoints under
 * `/api/v1/users`: listing accounts and changing an account's role.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerUserRoutes(app: FastifyInstance, { users }: Services): void {
  registerListUsers(app, users)
  registerSetUserRole(app, users)
}
