import type { FastifyInstance } from 'fastify'
import { EXPORT_TICKET_HEADER } from '../settings/service/ExportTicketService.js'
import { auth, type TestUser } from './harness.js'

/** The password `createUser` registers every test user with. */
export const TEST_USER_PASSWORD = 'correct-horse-battery-staple'

/**
 * Confirms the user's password the way the web app does and returns the export ticket.
 *
 * @param app - The app to ask.
 * @param user - A user from `createUser`.
 * @param password - What to type; the user's real password by default.
 * @returns The ticket.
 * @throws {Error} When the server does not answer `200`.
 */
export async function mintExportTicket(
  app: FastifyInstance, user: TestUser, password: string = TEST_USER_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/settings/export-ticket', headers: auth(user), payload: { password },
  })
  if (res.statusCode !== 200) throw new Error(`export ticket failed: ${res.statusCode} ${res.body}`)
  return (res.json() as { ticket: string }).ticket
}

/** Headers for `GET /api/v1/settings/export`: the user's bearer token and a ticket. */
export function exportHeaders(user: TestUser, ticket: string): Record<string, string> {
  return { ...auth(user), [EXPORT_TICKET_HEADER]: ticket }
}

/**
 * Downloads the user's export the way a client now has to: confirm the
 * password, then present the ticket. For the many tests that care about what
 * the export contains, not how it is reached.
 *
 * @param app - The app to ask.
 * @param user - A user from `createUser`.
 * @returns The export response.
 */
export async function exportAs(app: FastifyInstance, user: TestUser) {
  const ticket = await mintExportTicket(app, user)
  return app.inject({ method: 'GET', url: '/api/v1/settings/export', headers: exportHeaders(user, ticket) })
}
